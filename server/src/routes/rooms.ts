import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { createRoomCode, sanitizeSegment } from '../utils/identifiers.js'

const router = Router()

const createRoomSchema = z.object({
  roomCode: z.string().min(4).max(16).optional(),
})

router.post('/rooms', async (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid room payload.' })
    return
  }

  let selectedCode = parsed.data.roomCode ? sanitizeSegment(parsed.data.roomCode).toUpperCase() : ''

  if (!selectedCode) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = createRoomCode()
      const existingRoom = await prisma.room.findUnique({ where: { code: candidate } })
      if (!existingRoom) {
        selectedCode = candidate
        break
      }
    }
  }

  if (!selectedCode) {
    res.status(500).json({ ok: false, error: 'Could not allocate room code.' })
    return
  }

  const existingRoom = await prisma.room.findUnique({ where: { code: selectedCode } })
  if (existingRoom) {
    res.status(409).json({ ok: false, error: 'Room code already exists.' })
    return
  }

  const room = await prisma.room.create({
    data: {
      code: selectedCode,
      status: 'ACTIVE',
    },
  })

  res.status(201).json({
    ok: true,
    room: {
      id: room.id,
      roomId: room.code,
      code: room.code,
      status: room.status,
      createdAt: room.createdAt,
    },
  })
})

router.get('/rooms/:roomId', async (req, res) => {
  const roomCode = sanitizeSegment(req.params.roomId).toUpperCase()
  if (!roomCode) {
    res.status(400).json({ ok: false, error: 'Missing room code.' })
    return
  }

  const room = await prisma.room.findUnique({
    where: { code: roomCode },
    include: {
      sessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!room) {
    res.status(404).json({ ok: false, error: 'Room not found.' })
    return
  }

  res.json({
    ok: true,
    room: {
      id: room.id,
      roomId: room.code,
      code: room.code,
      status: room.status,
      latestSession: room.sessions[0]
        ? {
            id: room.sessions[0].id,
            status: room.sessions[0].status,
            startedAt: room.sessions[0].startedAt,
            endedAt: room.sessions[0].endedAt,
          }
        : null,
    },
  })
})

export default router
