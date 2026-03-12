import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { writeSessionManifest } from '../utils/manifest.js'
import { sanitizeSegment } from '../utils/identifiers.js'
import type { RecordingStorageAdapter } from '../storage/storage-adapter.js'

const startSessionSchema = z.object({
  roomId: z.string().min(1),
  hostParticipantId: z.string().min(1).optional(),
  hostName: z.string().min(1).optional(),
})

export const createSessionsRouter = (storageAdapter: RecordingStorageAdapter) => {
  const router = Router()

  router.get('/sessions', async (_req, res) => {
    const sessions = await prisma.session.findMany({
      include: {
        room: true,
        participants: {
          select: {
            id: true,
            externalId: true,
            name: true,
            role: true,
            status: true,
          },
        },
        tracks: {
          include: {
            _count: {
              select: {
                chunks: true,
              },
            },
            participant: {
              select: {
                name: true,
                externalId: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    res.json({
      ok: true,
      sessions: sessions.map((session: (typeof sessions)[number]) => ({
        id: session.id,
        roomId: session.room.code,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        manifestPath: session.manifestPath,
        participants: session.participants,
        totalTracks: session.tracks.length,
        totalChunks: session.tracks.reduce(
          (sum: number, track: (typeof session.tracks)[number]) => sum + track._count.chunks,
          0,
        ),
        trackFiles: session.tracks.map((track: (typeof session.tracks)[number]) => ({
          trackId: track.id,
          participantName: track.participant.name,
          participantId: track.participant.externalId,
          trackType: track.trackType,
          finalFilePath: track.finalFilePath,
          chunkCount: track._count.chunks,
          uploadCompleted: track.uploadCompleted,
        })),
      })),
    })
  })

  router.get('/sessions/:sessionId', async (req, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      include: {
        room: true,
        participants: {
          include: {
            tracks: {
              include: {
                chunks: {
                  orderBy: { sequenceNumber: 'asc' },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!session) {
      res.status(404).json({ ok: false, error: 'Session not found.' })
      return
    }

    res.json({
      ok: true,
      session: {
        id: session.id,
        roomId: session.room.code,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        manifestPath: session.manifestPath,
        participants: session.participants.map((participant: (typeof session.participants)[number]) => ({
          id: participant.id,
          externalId: participant.externalId,
          name: participant.name,
          role: participant.role,
          status: participant.status,
          tracks: participant.tracks.map((track: (typeof participant.tracks)[number]) => ({
            id: track.id,
            trackType: track.trackType,
            mimeType: track.mimeType,
            status: track.status,
            uploadCompleted: track.uploadCompleted,
            lastSequence: track.lastSequence,
            finalFilePath: track.finalFilePath,
            startedAt: track.startedAt,
            endedAt: track.endedAt,
            chunks: track.chunks.map((chunk: (typeof track.chunks)[number]) => ({
              id: chunk.id,
              sequenceNumber: chunk.sequenceNumber,
              timestamp: chunk.timestampMs,
              sizeBytes: chunk.sizeBytes,
              mimeType: chunk.mimeType,
              filePath: chunk.filePath,
            })),
          })),
        })),
      },
    })
  })

  router.post('/sessions/start', async (req, res) => {
    const parsed = startSessionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid start session payload.' })
      return
    }

    const roomCode = sanitizeSegment(parsed.data.roomId).toUpperCase()
    const room = await prisma.room.findUnique({ where: { code: roomCode } })

    if (!room) {
      res.status(404).json({ ok: false, error: 'Room not found.' })
      return
    }

    const session = await prisma.session.create({
      data: {
        roomId: room.id,
        status: 'RECORDING',
        startedAt: new Date(),
      },
    })

    if (parsed.data.hostParticipantId) {
      await prisma.participant.create({
        data: {
          externalId: parsed.data.hostParticipantId,
          roomId: room.id,
          sessionId: session.id,
          name: parsed.data.hostName ?? 'Host',
          role: 'HOST',
          status: 'CONNECTED',
        },
      })
    }

    res.status(201).json({
      ok: true,
      session: {
        id: session.id,
        roomId: room.code,
        status: session.status,
        startedAt: session.startedAt,
      },
    })
  })

  router.post('/sessions/:sessionId/complete', async (req, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      include: {
        room: true,
      },
    })

    if (!session) {
      res.status(404).json({ ok: false, error: 'Session not found.' })
      return
    }

    const incompleteTracks = await prisma.track.count({
      where: {
        sessionId: session.id,
        uploadCompleted: false,
      },
    })

    const nextStatus = incompleteTracks === 0 ? 'COMPLETED' : 'UPLOADING'

    await prisma.session.update({
      where: { id: session.id },
      data: {
        endedAt: new Date(),
        status: nextStatus,
      },
    })

    const manifestPath = await writeSessionManifest(prisma, storageAdapter, session.id)

    res.json({
      ok: true,
      session: {
        id: session.id,
        roomId: session.room.code,
        status: nextStatus,
        manifestPath,
      },
    })
  })

  return router
}
