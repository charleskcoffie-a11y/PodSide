import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import './App.css'

type RoomUser = {
  id: string
  name: string
}

type RemoteParticipant = {
  id: string
  name: string
  stream: MediaStream | null
}

type SignalPayload = {
  fromId: string
  sdp: RTCSessionDescriptionInit
}

type IcePayload = {
  fromId: string
  candidate: RTCIceCandidateInit
}

function App() {
  const apiBase = useMemo(
    () => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000',
    [],
  )

  const socketRef = useRef<Socket | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const localVideoRef = useRef<HTMLVideoElement | null>(null)

  const [displayName, setDisplayName] = useState('Host')
  const [roomId, setRoomId] = useState('podside-demo')
  const [status, setStatus] = useState('Connecting to signaling server...')
  const [joined, setJoined] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingUrl, setRecordingUrl] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadedUrl, setUploadedUrl] = useState('')

  const upsertParticipant = (id: string, name: string, stream: MediaStream | null) => {
    setRemoteParticipants((previous) => {
      const index = previous.findIndex((participant) => participant.id === id)
      if (index === -1) {
        return [...previous, { id, name, stream }]
      }

      const next = [...previous]
      const existing = next[index]
      next[index] = {
        ...existing,
        name: name || existing.name,
        stream: stream ?? existing.stream,
      }
      return next
    })
  }

  const removePeer = (peerId: string) => {
    const connection = peersRef.current.get(peerId)
    if (connection) {
      connection.close()
      peersRef.current.delete(peerId)
    }

    setRemoteParticipants((previous) => previous.filter((participant) => participant.id !== peerId))
  }

  const clearPeers = () => {
    peersRef.current.forEach((connection) => connection.close())
    peersRef.current.clear()
    setRemoteParticipants([])
  }

  const createOrGetPeerConnection = (peerId: string, peerName = 'Guest') => {
    const existing = peersRef.current.get(peerId)
    if (existing) {
      return existing
    }

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })

    const stream = localStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => {
        connection.addTrack(track, stream)
      })
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current) {
        return
      }

      socketRef.current.emit('ice-candidate', {
        targetId: peerId,
        candidate: event.candidate,
      })
    }

    connection.ontrack = (event) => {
      const [streamFromPeer] = event.streams
      upsertParticipant(peerId, peerName, streamFromPeer ?? null)
    }

    connection.onconnectionstatechange = () => {
      if (
        connection.connectionState === 'closed' ||
        connection.connectionState === 'failed' ||
        connection.connectionState === 'disconnected'
      ) {
        removePeer(peerId)
      }
    }

    peersRef.current.set(peerId, connection)
    upsertParticipant(peerId, peerName, null)

    return connection
  }

  const createAndSendOffer = async (peerId: string, peerName: string) => {
    const connection = createOrGetPeerConnection(peerId, peerName)
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)

    socketRef.current?.emit('offer', {
      targetId: peerId,
      sdp: offer,
    })
  }

  const handleOffer = async (fromId: string, sdp: RTCSessionDescriptionInit) => {
    const connection = createOrGetPeerConnection(fromId)
    await connection.setRemoteDescription(new RTCSessionDescription(sdp))

    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)

    socketRef.current?.emit('answer', {
      targetId: fromId,
      sdp: answer,
    })
  }

  const handleAnswer = async (fromId: string, sdp: RTCSessionDescriptionInit) => {
    const connection = peersRef.current.get(fromId)
    if (!connection) {
      return
    }

    await connection.setRemoteDescription(new RTCSessionDescription(sdp))
  }

  const handleIceCandidate = async (fromId: string, candidate: RTCIceCandidateInit) => {
    const connection = peersRef.current.get(fromId)
    if (!connection) {
      return
    }

    await connection.addIceCandidate(new RTCIceCandidate(candidate))
  }

  const ensureLocalStream = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      setLocalStream(media)
      setStatus('Camera and microphone are ready.')
      return media
    } catch {
      setStatus('Could not access camera or microphone.')
      return null
    }
  }

  const joinRoom = async () => {
    const normalizedRoomId = roomId.trim()
    if (!normalizedRoomId) {
      setStatus('Enter a room ID before joining.')
      return
    }

    const stream = await ensureLocalStream()
    if (!stream) {
      return
    }

    socketRef.current?.emit('join-room', {
      roomId: normalizedRoomId,
      name: displayName.trim() || 'Guest',
    })

    setJoined(true)
    setStatus(`Joined room ${normalizedRoomId}.`)
  }

  const leaveRoom = () => {
    socketRef.current?.emit('leave-room')
    setJoined(false)
    clearPeers()
    setStatus('Left room.')
  }

  const startRecording = async () => {
    const stream = await ensureLocalStream()
    if (!stream) {
      return
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      return
    }

    const options: MediaRecorderOptions = {}
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      options.mimeType = 'video/webm;codecs=vp9,opus'
    }

    const recorder = new MediaRecorder(stream, options)
    recordingChunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      })

      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl)
      }

      const nextUrl = URL.createObjectURL(blob)
      setRecordingBlob(blob)
      setRecordingUrl(nextUrl)
      setUploadMessage('Recording complete. You can download or upload it now.')
    }

    recorder.start(1000)
    mediaRecorderRef.current = recorder
    setRecordingBlob(null)
    setRecordingUrl('')
    setUploadedUrl('')
    setUploadMessage('Recording in progress...')
    setIsRecording(true)
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return
    }

    mediaRecorderRef.current.stop()
    setIsRecording(false)
  }

  const uploadRecording = async () => {
    if (!recordingBlob) {
      setUploadMessage('Record something first.')
      return
    }

    const formData = new FormData()
    const safeRoomId = roomId.trim() || 'room'
    const safeName = displayName.trim() || 'host'

    formData.append('recording', recordingBlob, `${safeRoomId}-${safeName}.webm`)
    formData.append('roomId', safeRoomId)
    formData.append('trackName', safeName)

    try {
      setUploadMessage('Uploading recording...')
      const response = await fetch(`${apiBase}/api/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const payload = (await response.json()) as {
        ok: boolean
        file?: { url: string }
      }

      const uploaded = payload.file?.url ? `${apiBase}${payload.file.url}` : ''
      setUploadedUrl(uploaded)
      setUploadMessage('Upload complete.')
    } catch {
      setUploadMessage('Upload failed. Check server logs and try again.')
    }
  }

  useEffect(() => {
    const socket = io(apiBase, {
      transports: ['websocket'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setStatus('Connected to signaling server.')
    })

    socket.on('disconnect', () => {
      setJoined(false)
      clearPeers()
      setStatus('Disconnected from signaling server.')
    })

    socket.on('room-users', async ({ users }: { users: RoomUser[] }) => {
      setRemoteParticipants(
        users.map((user) => ({
          id: user.id,
          name: user.name,
          stream: null,
        })),
      )

      for (const user of users) {
        await createAndSendOffer(user.id, user.name)
      }

      setStatus(`Room ready. Connected to ${users.length} participant(s).`)
    })

    socket.on('user-joined', ({ id, name }: RoomUser) => {
      upsertParticipant(id, name, null)
      setStatus(`${name} joined the room.`)
    })

    socket.on('offer', async ({ fromId, sdp }: SignalPayload) => {
      await handleOffer(fromId, sdp)
    })

    socket.on('answer', async ({ fromId, sdp }: SignalPayload) => {
      await handleAnswer(fromId, sdp)
    })

    socket.on('ice-candidate', async ({ fromId, candidate }: IcePayload) => {
      await handleIceCandidate(fromId, candidate)
    })

    socket.on('user-left', ({ id }: { id: string }) => {
      removePeer(id)
      setStatus('A participant left the room.')
    })

    return () => {
      socket.disconnect()
      clearPeers()
    }
  }, [apiBase])

  useEffect(() => {
    localStreamRef.current = localStream
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    return () => {
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl)
      }
    }
  }, [recordingUrl])

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <main className="app">
      <header className="panel controls">
        <h1>Podside Studio (Riverside-style MVP)</h1>

        <div className="field-row">
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Host"
            />
          </label>

          <label>
            Room ID
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="podside-demo"
            />
          </label>
        </div>

        <div className="button-row">
          <button onClick={ensureLocalStream}>Start Camera + Mic</button>
          <button onClick={joinRoom} disabled={joined}>
            Join Room
          </button>
          <button onClick={leaveRoom} disabled={!joined}>
            Leave Room
          </button>
          <button onClick={startRecording} disabled={isRecording}>
            Start Recording
          </button>
          <button onClick={stopRecording} disabled={!isRecording}>
            Stop Recording
          </button>
          <button onClick={uploadRecording} disabled={!recordingBlob}>
            Upload Recording
          </button>
        </div>

        <p className="status">{status}</p>
        {uploadMessage && <p className="status">{uploadMessage}</p>}
        {recordingUrl && (
          <a
            className="link"
            href={recordingUrl}
            download={`${roomId || 'room'}-${displayName || 'host'}.webm`}
          >
            Download latest recording
          </a>
        )}
        {uploadedUrl && (
          <a className="link" href={uploadedUrl} target="_blank" rel="noreferrer">
            Open uploaded file
          </a>
        )}
      </header>

      <section className="panel video-section">
        <article className="video-card">
          <h2>Local</h2>
          <video ref={localVideoRef} autoPlay muted playsInline />
        </article>

        {remoteParticipants.map((participant) => (
          <article key={participant.id} className="video-card">
            <h2>{participant.name}</h2>
            <video
              ref={(element) => {
                if (element && participant.stream && element.srcObject !== participant.stream) {
                  element.srcObject = participant.stream
                }
              }}
              autoPlay
              playsInline
            />
          </article>
        ))}
      </section>
    </main>
  )
}

export default App
