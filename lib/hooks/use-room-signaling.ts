'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { NameStyle, ParticipantRole, RoomUser, UploadProgress } from '../types'

type UseRoomSignalingOptions = {
  serverUrl: string
  roomId: string
  participantId: string
  participantName: string
  participantNameStyle: NameStyle
  role: ParticipantRole
  localStream: MediaStream | null
  onHostStartRecording?: (payload: { sessionId: string; chunkIntervalMs: number }) => void
  onHostStopRecording?: () => void
  onGuestJoinRequest?: (payload: { guestSocketId: string; participantId: string; name: string; nameStyle: NameStyle }) => void
  onGuestJoinCancelled?: (payload: { guestSocketId: string; participantId: string }) => void
}

const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export const useRoomSignaling = ({
  serverUrl,
  roomId,
  participantId,
  participantName,
  participantNameStyle,
  role,
  localStream,
  onHostStartRecording,
  onHostStopRecording,
  onGuestJoinRequest,
  onGuestJoinCancelled,
}: UseRoomSignalingOptions) => {
  const socketRef = useRef<Socket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const remoteSocketIdRef = useRef<string | null>(null)

  const [connected, setConnected] = useState(false)
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joinPendingApproval, setJoinPendingApproval] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [remoteUser, setRemoteUser] = useState<RoomUser | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [uploadProgressMap, setUploadProgressMap] = useState<Record<string, UploadProgress>>({})

  const ensurePeerConnection = useCallback(
    (targetSocketId: string) => {
      if (peerRef.current && remoteSocketIdRef.current === targetSocketId) {
        return peerRef.current
      }

      peerRef.current?.close()

      const peer = new RTCPeerConnection({ iceServers })
      remoteSocketIdRef.current = targetSocketId

      if (localStream) {
        localStream.getTracks().forEach((track) => {
          peer.addTrack(track, localStream)
        })
      }

      peer.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          setRemoteStream(stream)
        }
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate || !socketRef.current || !remoteSocketIdRef.current) {
          return
        }

        socketRef.current.emit('ice-candidate', {
          targetId: remoteSocketIdRef.current,
          candidate: event.candidate,
        })
      }

      peer.onconnectionstatechange = () => {
        const state = peer.connectionState
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setRemoteStream(null)
        }
      }

      peerRef.current = peer
      return peer
    },
    [localStream],
  )

  const createOfferFor = useCallback(
    async (remoteSocketId: string) => {
      const peer = ensurePeerConnection(remoteSocketId)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)

      socketRef.current?.emit('offer', {
        targetId: remoteSocketId,
        sdp: offer,
      })
    },
    [ensurePeerConnection],
  )

  const leaveRoom = useCallback(() => {
    setJoined(false)
    setJoining(false)
    setJoinPendingApproval(false)
    setRemoteUser(null)
    setRemoteStream(null)
    setActiveSessionId(null)
    socketRef.current?.emit('leave-room')
    peerRef.current?.close()
    peerRef.current = null
    remoteSocketIdRef.current = null
  }, [])

  const joinRoom = useCallback(() => {
    setJoinError(null)

    if (!socketRef.current) {
      setJoinError('Socket not initialized yet.')
      return
    }

    setJoining(true)
    setJoinPendingApproval(false)

    socketRef.current.emit('join-room', {
      roomId,
      name: participantName,
      nameStyle: participantNameStyle,
      participantId,
      role,
    })
  }, [participantId, participantName, participantNameStyle, role, roomId])

  const approveGuestJoin = useCallback((guestSocketId: string, approved: boolean) => {
    socketRef.current?.emit('host-guest-decision', {
      guestSocketId,
      approved,
    })
  }, [])

  const emitHostStartRecording = useCallback(
    (sessionId: string, chunkIntervalMs: number) => {
      socketRef.current?.emit('host-start-recording', {
        roomId,
        sessionId,
        chunkIntervalMs,
      })
    },
    [roomId],
  )

  const emitHostStopRecording = useCallback(() => {
    socketRef.current?.emit('host-stop-recording', { roomId })
  }, [roomId])

  const emitUploadProgress = useCallback(
    (progress: Omit<UploadProgress, 'roomId'>) => {
      socketRef.current?.emit('upload-progress', {
        roomId,
        ...progress,
      })
    },
    [roomId],
  )

  useEffect(() => {
    const socket = io(serverUrl, {
      transports: ['websocket'],
      withCredentials: false,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
    })

    socket.on('disconnect', () => {
      setConnected(false)
      setJoined(false)
      setJoining(false)
      setJoinPendingApproval(false)
      setRemoteUser(null)
      setRemoteStream(null)
      peerRef.current?.close()
      peerRef.current = null
      remoteSocketIdRef.current = null
    })

    socket.on('join-error', ({ message }: { message: string }) => {
      setJoinError(message)
      setJoined(false)
      setJoining(false)
      setJoinPendingApproval(false)
    })

    socket.on('join-pending', ({ message }: { message: string }) => {
      if (message) {
        setJoinError(null)
      }
      setJoined(false)
      setJoining(false)
      setJoinPendingApproval(true)
    })

    socket.on(
      'room-users',
      async ({ users, activeSessionId: nextSessionId }: { users: RoomUser[]; activeSessionId: string | null }) => {
        setJoined(true)
        setJoining(false)
        setJoinPendingApproval(false)
        setJoinError(null)
        setActiveSessionId(nextSessionId)

        const remote = users[0] ?? null
        setRemoteUser(remote)

        if (remote && role === 'host') {
          await createOfferFor(remote.id)
        }
      },
    )

    socket.on('user-joined', async (user: RoomUser) => {
      setRemoteUser(user)
      if (role === 'host') {
        await createOfferFor(user.id)
      }
    })

    socket.on(
      'guest-join-request',
      (payload: { guestSocketId: string; participantId: string; name: string; nameStyle: NameStyle }) => {
        onGuestJoinRequest?.(payload)
      },
    )

    socket.on('guest-join-cancelled', (payload: { guestSocketId: string; participantId: string }) => {
      onGuestJoinCancelled?.(payload)
    })

    socket.on('user-left', () => {
      setRemoteUser(null)
      setRemoteStream(null)
      peerRef.current?.close()
      peerRef.current = null
      remoteSocketIdRef.current = null
    })

    socket.on('offer', async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = ensurePeerConnection(fromId)
      await peer.setRemoteDescription(new RTCSessionDescription(sdp))

      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)

      socket.emit('answer', {
        targetId: fromId,
        sdp: answer,
      })
    })

    socket.on('answer', async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = ensurePeerConnection(fromId)
      await peer.setRemoteDescription(new RTCSessionDescription(sdp))
    })

    socket.on(
      'ice-candidate',
      async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
        const peer = ensurePeerConnection(fromId)
        await peer.addIceCandidate(new RTCIceCandidate(candidate))
      },
    )

    socket.on('host-start-recording', (payload: { sessionId: string; chunkIntervalMs: number }) => {
      setActiveSessionId(payload.sessionId)
      onHostStartRecording?.(payload)
    })

    socket.on('host-stop-recording', () => {
      onHostStopRecording?.()
    })

    socket.on('participant-upload-progress', (payload: UploadProgress) => {
      setUploadProgressMap((previous) => ({
        ...previous,
        [payload.participantId]: payload,
      }))
    })

    return () => {
      socket.disconnect()
      peerRef.current?.close()
      peerRef.current = null
      remoteSocketIdRef.current = null
    }
  }, [createOfferFor, ensurePeerConnection, onGuestJoinCancelled, onGuestJoinRequest, onHostStartRecording, onHostStopRecording, role, serverUrl])

  useEffect(() => {
    if (!peerRef.current || !localStream) {
      return
    }

    const existingTrackIds = new Set(
      peerRef.current.getSenders().map((sender) => sender.track?.id).filter(Boolean) as string[],
    )

    localStream.getTracks().forEach((track) => {
      if (!existingTrackIds.has(track.id)) {
        peerRef.current?.addTrack(track, localStream)
      }
    })
  }, [localStream])

  return {
    connected,
    joined,
    joining,
    joinPendingApproval,
    joinError,
    remoteUser,
    remoteStream,
    activeSessionId,
    uploadProgressMap,
    joinRoom,
    leaveRoom,
    approveGuestJoin,
    emitHostStartRecording,
    emitHostStopRecording,
    emitUploadProgress,
  }
}
