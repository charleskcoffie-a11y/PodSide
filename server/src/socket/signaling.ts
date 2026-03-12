import type { Server, Socket } from 'socket.io'
import { sanitizeSegment } from '../utils/identifiers.js'

type JoinRoomPayload = {
  roomId: string
  name: string
  nameStyle?: string
  participantId: string
  role: 'host' | 'guest'
}

type NameStyle = 'classic' | 'uppercase' | 'highlight'

type SignalPayload = {
  targetId: string
  sdp: Record<string, unknown>
}

type IcePayload = {
  targetId: string
  candidate: Record<string, unknown>
}

type UploadProgressPayload = {
  roomId: string
  participantId: string
  uploadedChunks: number
  pendingChunks: number
  failedChunks: number
  retrying: boolean
}

type ParticipantInfo = {
  socketId: string
  participantId: string
  name: string
  nameStyle: NameStyle
  role: 'host' | 'guest'
}

type PendingGuestRequest = {
  roomId: string
  participant: ParticipantInfo
}

type JoinRoomFailure = {
  ok: false
  reason: string
}

type JoinRoomSuccess = {
  ok: true
  pending?: false
  roomId: string
  self: ParticipantInfo
  existingMembers: ParticipantInfo[]
  activeSessionId: string | null
}

type JoinRoomPending = {
  ok: true
  pending: true
}

const roomMembers = new Map<string, Map<string, ParticipantInfo>>()
const roomActiveSession = new Map<string, string>()
const socketRoomLookup = new Map<string, string>()
const pendingGuestRequests = new Map<string, PendingGuestRequest>()

const normalizeNameStyle = (raw: string | undefined): NameStyle => {
  if (raw === 'uppercase' || raw === 'highlight') {
    return raw
  }

  return 'classic'
}

const getMembersArray = (roomId: string) => {
  const members = roomMembers.get(roomId)
  return members ? [...members.values()] : []
}

const roomHasPendingGuest = (roomId: string) => {
  for (const pending of pendingGuestRequests.values()) {
    if (pending.roomId === roomId) {
      return true
    }
  }

  return false
}

const getHostInRoom = (roomId: string) => getMembersArray(roomId).find((member) => member.role === 'host') ?? null

const addMemberToRoom = (socket: Socket, roomId: string, member: ParticipantInfo): JoinRoomSuccess => {
  const members = roomMembers.get(roomId) ?? new Map<string, ParticipantInfo>()
  const existingMembers = [...members.values()]

  socket.join(roomId)

  members.set(socket.id, member)
  roomMembers.set(roomId, members)
  socketRoomLookup.set(socket.id, roomId)

  return {
    ok: true,
    pending: false,
    roomId,
    self: member,
    existingMembers,
    activeSessionId: roomActiveSession.get(roomId) ?? null,
  }
}

const removeSocket = (io: Server, socketId: string) => {
  const pending = pendingGuestRequests.get(socketId)
  if (pending) {
    pendingGuestRequests.delete(socketId)

    const host = getHostInRoom(pending.roomId)
    if (host) {
      io.to(host.socketId).emit('guest-join-cancelled', {
        guestSocketId: socketId,
        participantId: pending.participant.participantId,
      })
    }
  }

  const roomId = socketRoomLookup.get(socketId)
  if (!roomId) {
    return
  }

  const members = roomMembers.get(roomId)
  if (!members) {
    socketRoomLookup.delete(socketId)
    return
  }

  const participant = members.get(socketId)
  members.delete(socketId)
  socketRoomLookup.delete(socketId)

  if (members.size === 0) {
    roomMembers.delete(roomId)
    roomActiveSession.delete(roomId)
  }

  if (participant) {
    io.to(roomId).emit('user-left', {
      id: participant.socketId,
      participantId: participant.participantId,
    })
  }
}

const canJoinRoom = (roomId: string, role: 'host' | 'guest'): JoinRoomFailure | { ok: true } => {
  const members = getMembersArray(roomId)

  if (members.length >= 2) {
    return { ok: false, reason: 'Room already has host and guest.' }
  }

  if (role === 'host' && members.some((member) => member.role === 'host')) {
    return { ok: false, reason: 'Room already has a host.' }
  }

  if (role === 'guest' && members.some((member) => member.role === 'guest')) {
    return { ok: false, reason: 'Room already has a guest.' }
  }

  if (role === 'guest' && roomHasPendingGuest(roomId)) {
    return { ok: false, reason: 'A guest is already waiting for host approval.' }
  }

  return { ok: true }
}

const joinRoom = (io: Server, socket: Socket, payload: JoinRoomPayload): JoinRoomFailure | JoinRoomSuccess | JoinRoomPending => {
  const roomId = sanitizeSegment(payload.roomId).toUpperCase()
  const name = payload.name?.trim() || (payload.role === 'host' ? 'Host' : 'Guest')
  const nameStyle = normalizeNameStyle(payload.nameStyle)
  const participantId = sanitizeSegment(payload.participantId)

  if (!roomId || !participantId) {
    return { ok: false, reason: 'Invalid room or participant identifier.' }
  }

  const joinState = canJoinRoom(roomId, payload.role)
  if (!joinState.ok) {
    return joinState
  }

  const member: ParticipantInfo = {
    socketId: socket.id,
    participantId,
    name,
    nameStyle,
    role: payload.role,
  }

  if (payload.role === 'guest') {
    const host = getHostInRoom(roomId)
    if (!host) {
      return { ok: false, reason: 'Host is not in the room yet.' }
    }

    pendingGuestRequests.set(socket.id, {
      roomId,
      participant: member,
    })

    io.to(host.socketId).emit('guest-join-request', {
      guestSocketId: socket.id,
      participantId: member.participantId,
      name: member.name,
      nameStyle: member.nameStyle,
    })

    return {
      ok: true,
      pending: true,
    }
  }

  return addMemberToRoom(socket, roomId, member)
}

export const installSignalingHandlers = (io: Server) => {
  io.on('connection', (socket) => {
    socket.on('join-room', (payload: JoinRoomPayload) => {
      removeSocket(io, socket.id)

      const joined = joinRoom(io, socket, payload)
      if (!joined.ok) {
        socket.emit('join-error', { message: joined.reason })
        return
      }

      if (joined.pending) {
        socket.emit('join-pending', { message: 'Waiting for host approval.' })
        return
      }

      socket.emit('room-users', {
        users: joined.existingMembers.map((member) => ({
          id: member.socketId,
          participantId: member.participantId,
          name: member.name,
          nameStyle: member.nameStyle,
          role: member.role,
        })),
        activeSessionId: joined.activeSessionId,
      })

      socket.to(joined.roomId).emit('user-joined', {
        id: joined.self.socketId,
        participantId: joined.self.participantId,
        name: joined.self.name,
        nameStyle: joined.self.nameStyle,
        role: joined.self.role,
      })
    })

    socket.on('host-guest-decision', ({ guestSocketId, approved }: { guestSocketId: string; approved: boolean }) => {
      const hostRoomId = socketRoomLookup.get(socket.id)
      if (!hostRoomId) {
        return
      }

      const host = roomMembers.get(hostRoomId)?.get(socket.id)
      if (!host || host.role !== 'host') {
        return
      }

      const pending = pendingGuestRequests.get(guestSocketId)
      if (!pending || pending.roomId !== hostRoomId) {
        return
      }

      pendingGuestRequests.delete(guestSocketId)

      const guestSocket = io.sockets.sockets.get(guestSocketId)
      if (!guestSocket) {
        return
      }

      if (!approved) {
        guestSocket.emit('join-error', { message: 'Host declined your request to join.' })
        return
      }

      const joinState = canJoinRoom(hostRoomId, 'guest')
      if (!joinState.ok) {
        guestSocket.emit('join-error', { message: joinState.reason })
        return
      }

      const joined = addMemberToRoom(guestSocket, hostRoomId, pending.participant)

      guestSocket.emit('room-users', {
        users: joined.existingMembers.map((member) => ({
          id: member.socketId,
          participantId: member.participantId,
          name: member.name,
          nameStyle: member.nameStyle,
          role: member.role,
        })),
        activeSessionId: joined.activeSessionId,
      })

      guestSocket.to(joined.roomId).emit('user-joined', {
        id: joined.self.socketId,
        participantId: joined.self.participantId,
        name: joined.self.name,
        nameStyle: joined.self.nameStyle,
        role: joined.self.role,
      })
    })

    socket.on('offer', ({ targetId, sdp }: SignalPayload) => {
      io.to(targetId).emit('offer', { fromId: socket.id, sdp })
    })

    socket.on('answer', ({ targetId, sdp }: SignalPayload) => {
      io.to(targetId).emit('answer', { fromId: socket.id, sdp })
    })

    socket.on('ice-candidate', ({ targetId, candidate }: IcePayload) => {
      io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate })
    })

    socket.on(
      'host-start-recording',
      ({ roomId, sessionId, chunkIntervalMs }: { roomId: string; sessionId: string; chunkIntervalMs: number }) => {
        const normalizedRoomId = sanitizeSegment(roomId).toUpperCase()
        const normalizedSessionId = sanitizeSegment(sessionId)

        if (!normalizedRoomId || !normalizedSessionId) {
          return
        }

        roomActiveSession.set(normalizedRoomId, normalizedSessionId)

        io.to(normalizedRoomId).emit('host-start-recording', {
          sessionId: normalizedSessionId,
          chunkIntervalMs,
        })
      },
    )

    socket.on('host-stop-recording', ({ roomId }: { roomId: string }) => {
      const normalizedRoomId = sanitizeSegment(roomId).toUpperCase()
      if (!normalizedRoomId) {
        return
      }

      io.to(normalizedRoomId).emit('host-stop-recording')
    })

    socket.on('upload-progress', (payload: UploadProgressPayload) => {
      const normalizedRoomId = sanitizeSegment(payload.roomId).toUpperCase()
      if (!normalizedRoomId) {
        return
      }

      io.to(normalizedRoomId).emit('participant-upload-progress', payload)
    })

    socket.on('leave-room', () => {
      removeSocket(io, socket.id)
    })

    socket.on('disconnect', () => {
      removeSocket(io, socket.id)
    })
  })
}
