import type { PrismaClient } from '@prisma/client'
import type { RecordingStorageAdapter } from '../storage/storage-adapter.js'

export const writeSessionManifest = async (
  client: PrismaClient,
  storage: RecordingStorageAdapter,
  sessionId: string,
) => {
  const session = await client.session.findUnique({
    where: { id: sessionId },
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
      tracks: {
        include: {
          chunks: {
            orderBy: { sequenceNumber: 'asc' },
          },
          participant: true,
        },
      },
    },
  })

  if (!session) {
    throw new Error('Session not found')
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    room: {
      id: session.room.id,
      code: session.room.code,
    },
    session: {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    },
    participants: session.participants.map((participant: (typeof session.participants)[number]) => ({
      id: participant.id,
      externalId: participant.externalId,
      name: participant.name,
      role: participant.role,
      status: participant.status,
      tracks: participant.tracks.map((track: (typeof participant.tracks)[number]) => ({
        id: track.id,
        type: track.trackType,
        mimeType: track.mimeType,
        status: track.status,
        uploadCompleted: track.uploadCompleted,
        lastSequence: track.lastSequence,
        finalFilePath: track.finalFilePath,
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
    // TODO: Add multi-track sync metadata and FFmpeg merged output references.
  }

  const manifestWriteResult = await storage.writeManifest({
    roomCode: session.room.code,
    sessionId: session.id,
    manifest,
  })

  await client.session.update({
    where: { id: session.id },
    data: { manifestPath: manifestWriteResult.relativePath },
  })

  return manifestWriteResult.relativePath
}
