import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { toTrackType, sanitizeSegment } from '../utils/identifiers.js'
import type { RecordingStorageAdapter } from '../storage/storage-adapter.js'
import { writeSessionManifest } from '../utils/manifest.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 200,
  },
})

const chunkSchema = z.object({
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
  participantName: z.string().optional(),
  role: z.string().optional(),
  trackType: z.string().min(1).default('camera-mic'),
  sequenceNumber: z.coerce.number().int().min(1),
  timestamp: z.union([z.string().min(1), z.coerce.number().int().nonnegative()]),
  mimeType: z.string().optional(),
  replaceExisting: z.union([z.boolean(), z.string()]).optional(),
})

const finalizeSchema = z.object({
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
  trackType: z.string().min(1).default('camera-mic'),
})

const parseRole = (value: string | undefined) => {
  if (!value) {
    return 'GUEST' as const
  }

  const normalized = value.toUpperCase()
  return normalized === 'HOST' ? ('HOST' as const) : ('GUEST' as const)
}

const shouldReplaceExisting = (value: boolean | string | undefined) => value === true || value === 'true'

const extensionFromUpload = (originalName: string, mimeType: string) => {
  const fromName = path.extname(originalName)
  if (fromName) {
    return fromName
  }

  if (mimeType.includes('webm')) {
    return '.webm'
  }

  if (mimeType.includes('ogg')) {
    return '.ogg'
  }

  if (mimeType.includes('mp4')) {
    return '.mp4'
  }

  return '.bin'
}

const extensionFromMimeType = (mimeType: string) => {
  if (mimeType.includes('webm')) {
    return '.webm'
  }

  if (mimeType.includes('ogg')) {
    return '.ogg'
  }

  if (mimeType.includes('mp4')) {
    return '.mp4'
  }

  return '.bin'
}

export const createUploadsRouter = (storageAdapter: RecordingStorageAdapter) => {
  const router = Router()

  router.post('/uploads/chunk', upload.single('chunk'), async (req, res) => {
    const parsed = chunkSchema.safeParse(req.body ?? {})

    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid chunk metadata.' })
      return
    }

    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Chunk file is required.' })
      return
    }

    const roomCode = sanitizeSegment(parsed.data.roomId).toUpperCase()
    const sessionId = sanitizeSegment(parsed.data.sessionId)
    const participantExternalId = sanitizeSegment(parsed.data.participantId)
    const trackType = toTrackType(parsed.data.trackType)
    const sequenceNumber = parsed.data.sequenceNumber
    const timestamp = String(parsed.data.timestamp)
    const replaceExisting = shouldReplaceExisting(parsed.data.replaceExisting)

    const room = await prisma.room.findUnique({ where: { code: roomCode } })
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found.' })
      return
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session || session.roomId !== room.id) {
      res.status(404).json({ ok: false, error: 'Session not found for this room.' })
      return
    }

    const participant = await prisma.participant.upsert({
      where: {
        externalId_roomId_sessionId: {
          externalId: participantExternalId,
          roomId: room.id,
          sessionId: session.id,
        },
      },
      update: {
        status: 'CONNECTED',
        name: parsed.data.participantName || undefined,
      },
      create: {
        externalId: participantExternalId,
        roomId: room.id,
        sessionId: session.id,
        name: parsed.data.participantName ?? 'Guest',
        role: parseRole(parsed.data.role),
        status: 'CONNECTED',
      },
    })

    const track = await prisma.track.upsert({
      where: {
        sessionId_participantId_trackType: {
          sessionId: session.id,
          participantId: participant.id,
          trackType,
        },
      },
      update: {
        status: 'UPLOADING',
        mimeType: parsed.data.mimeType ?? req.file.mimetype,
      },
      create: {
        sessionId: session.id,
        participantId: participant.id,
        roomId: room.id,
        trackType,
        mimeType: parsed.data.mimeType ?? req.file.mimetype,
        status: 'UPLOADING',
      },
    })

    const existingChunk = await prisma.chunk.findUnique({
      where: {
        trackId_sequenceNumber: {
          trackId: track.id,
          sequenceNumber,
        },
      },
    })

    if (existingChunk && !replaceExisting) {
      res.status(409).json({
        ok: false,
        error: 'Chunk sequence already exists. Send replaceExisting=true to overwrite.',
      })
      return
    }

    if (existingChunk?.filePath) {
      await storageAdapter.deleteRelativeFile(existingChunk.filePath)
    }

    const saveResult = await storageAdapter.saveChunk({
      roomCode,
      sessionId: session.id,
      participantId: participantExternalId,
      trackType,
      sequenceNumber,
      extension: extensionFromUpload(req.file.originalname, req.file.mimetype),
      buffer: req.file.buffer,
    })

    if (existingChunk) {
      await prisma.chunk.update({
        where: { id: existingChunk.id },
        data: {
          timestampMs: timestamp,
          sizeBytes: req.file.size,
          mimeType: parsed.data.mimeType ?? req.file.mimetype,
          filePath: saveResult.relativePath,
          uploadState: 'REPLACED',
        },
      })
    } else {
      await prisma.chunk.create({
        data: {
          trackId: track.id,
          sequenceNumber,
          timestampMs: timestamp,
          sizeBytes: req.file.size,
          mimeType: parsed.data.mimeType ?? req.file.mimetype,
          filePath: saveResult.relativePath,
          uploadState: 'UPLOADED',
        },
      })
    }

    await prisma.track.update({
      where: { id: track.id },
      data: {
        status: 'UPLOADING',
        lastSequence: Math.max(track.lastSequence, sequenceNumber),
      },
    })

    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'UPLOADING' },
    })

    res.status(201).json({
      ok: true,
      chunk: {
        sequenceNumber,
        filePath: saveResult.relativePath,
      },
    })
  })

  router.post('/uploads/finalize', async (req, res) => {
    const parsed = finalizeSchema.safeParse(req.body ?? {})

    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid finalize payload.' })
      return
    }

    const roomCode = sanitizeSegment(parsed.data.roomId).toUpperCase()
    const sessionId = sanitizeSegment(parsed.data.sessionId)
    const participantExternalId = sanitizeSegment(parsed.data.participantId)
    const trackType = toTrackType(parsed.data.trackType)

    const room = await prisma.room.findUnique({ where: { code: roomCode } })
    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found.' })
      return
    }

    const participant = await prisma.participant.findUnique({
      where: {
        externalId_roomId_sessionId: {
          externalId: participantExternalId,
          roomId: room.id,
          sessionId,
        },
      },
    })

    if (!participant) {
      res.status(404).json({ ok: false, error: 'Participant not found.' })
      return
    }

    const track = await prisma.track.findUnique({
      where: {
        sessionId_participantId_trackType: {
          sessionId,
          participantId: participant.id,
          trackType,
        },
      },
    })

    if (!track) {
      res.status(404).json({ ok: false, error: 'Track not found.' })
      return
    }

    const orderedChunks = await prisma.chunk.findMany({
      where: { trackId: track.id },
      orderBy: { sequenceNumber: 'asc' },
    })

    if (orderedChunks.length === 0) {
      res.status(400).json({ ok: false, error: 'No uploaded chunks found for this track.' })
      return
    }

    const combinedBuffers = await Promise.all(
      orderedChunks.map((chunk: (typeof orderedChunks)[number]) =>
        storageAdapter.readRelativeFile(chunk.filePath),
      ),
    )

    const combinedTrackWrite = await storageAdapter.writeCombinedTrack({
      roomCode,
      sessionId,
      participantId: participantExternalId,
      trackType,
      extension: extensionFromMimeType(track.mimeType),
      chunks: combinedBuffers,
    })

    await prisma.track.update({
      where: { id: track.id },
      data: {
        status: 'COMPLETED',
        uploadCompleted: true,
        endedAt: new Date(),
        finalFilePath: combinedTrackWrite.relativePath,
      },
    })

    const incompleteTracks = await prisma.track.count({
      where: {
        sessionId,
        uploadCompleted: false,
      },
    })

    const nextSessionStatus = incompleteTracks === 0 ? 'COMPLETED' : 'UPLOADING'

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: nextSessionStatus,
        endedAt: nextSessionStatus === 'COMPLETED' ? new Date() : undefined,
      },
    })

    const manifestPath = await writeSessionManifest(prisma, storageAdapter, sessionId)

    res.json({
      ok: true,
      manifestPath,
      sessionStatus: nextSessionStatus,
      finalFilePath: combinedTrackWrite.relativePath,
    })
  })

  return router
}
