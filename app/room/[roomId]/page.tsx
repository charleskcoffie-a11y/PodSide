'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/room/status-badge'
import { VideoTile } from '@/components/room/video-tile'
import { UploadProgressCard } from '@/components/room/upload-progress-card'
import { appConfig } from '@/lib/config'
import {
  completeSession,
  finalizeTrackUpload,
  getRoom,
  startSession,
} from '@/lib/api-client'
import { useMediaStream } from '@/lib/hooks/use-media-stream'
import { useChunkedRecorder } from '@/lib/hooks/use-chunked-recorder'
import { useMixedRecorder } from '@/lib/hooks/use-mixed-recorder'
import { useRoomSignaling } from '@/lib/hooks/use-room-signaling'
import { ChunkUploadQueue, type QueueState } from '@/lib/upload/upload-queue'
import { clearActiveSession, getActiveSession, saveActiveSession } from '@/lib/room-session-storage'
import type { NameStyle, ParticipantRole, SessionStatus } from '@/lib/types'
import type { StreamMixerLayout } from '@/lib/mixer/stream-mixer'

const trackType = 'camera-mic'

const defaultQueueState: QueueState = {
  pendingChunks: 0,
  uploadedChunks: 0,
  failedChunks: 0,
  retrying: false,
  lastError: null,
}

const toRole = (rawRole: string | null): ParticipantRole => (rawRole?.toLowerCase() === 'host' ? 'host' : 'guest')
const toNameStyle = (rawStyle: string | null): NameStyle =>
  rawStyle === 'uppercase' || rawStyle === 'highlight' ? rawStyle : 'classic'
const styleDisplayName = (name: string, nameStyle: NameStyle) => {
  if (nameStyle === 'uppercase') {
    return name.toUpperCase()
  }

  if (nameStyle === 'highlight') {
    return `✨ ${name}`
  }

  return name
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>()
  const searchParams = useSearchParams()

  const roomId = useMemo(() => params.roomId.toUpperCase(), [params.roomId])
  const role = useMemo(() => toRole(searchParams.get('role')), [searchParams])
  const participantName = useMemo(
    () => searchParams.get('name')?.trim() || (role === 'host' ? 'Host' : 'Guest'),
    [role, searchParams],
  )
  const participantNameStyle = useMemo(() => toNameStyle(searchParams.get('nameStyle')), [searchParams])
  const participantId = useMemo(() => searchParams.get('participantId')?.trim() || `anon-${Date.now()}`, [searchParams])

  const [roomError, setRoomError] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [queueState, setQueueState] = useState<QueueState>(defaultQueueState)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [finalizationError, setFinalizationError] = useState<string | null>(null)
  const [inviteCopyState, setInviteCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [isTeleprompterEnabled, setIsTeleprompterEnabled] = useState(false)
  const [isTeleprompterAutoScrollEnabled, setIsTeleprompterAutoScrollEnabled] = useState(false)
  const [teleprompterText, setTeleprompterText] = useState('')
  const [teleprompterFontSize, setTeleprompterFontSize] = useState(32)
  const [teleprompterScrollSpeed, setTeleprompterScrollSpeed] = useState(1)
  const [mixerLayout, setMixerLayout] = useState<StreamMixerLayout>('side-by-side')
  const [remoteStreamsMap, setRemoteStreamsMap] = useState<Map<string, { stream: MediaStream; name: string }>>(new Map())
  const [pendingGuestJoin, setPendingGuestJoin] = useState<{
    guestSocketId: string
    participantId: string
    name: string
    nameStyle: NameStyle
  } | null>(null)

  const queueRef = useRef<ChunkUploadQueue | null>(null)
  const hostSessionCompletedRef = useRef(false)
  const teleprompterScrollRef = useRef<HTMLDivElement | null>(null)

  const { stream: localStream, error: mediaError, requestMedia, stopMedia } = useMediaStream()

  const handleFinalizeUploads = useCallback(async () => {
    if (!sessionId || isFinalizing) {
      return
    }

    setIsFinalizing(true)
    setFinalizationError(null)

    try {
      const queue = queueRef.current
      if (queue) {
        const flushed = await queue.flushAndWait()
        if (!flushed) {
          throw new Error('Timed out waiting for pending chunk uploads.')
        }
      }

      await finalizeTrackUpload({
        roomId,
        sessionId,
        participantId,
        trackType,
      })

      if (role === 'host' && !hostSessionCompletedRef.current) {
        await completeSession(sessionId)
        hostSessionCompletedRef.current = true
      }

      clearActiveSession(roomId, participantId)
      setStatus('completed')
    } catch (error) {
      setStatus('upload-failed')
      setFinalizationError(error instanceof Error ? error.message : 'Could not finalize upload.')
    } finally {
      setIsFinalizing(false)
    }
  }, [isFinalizing, participantId, role, roomId, sessionId])

  const handleRecorderChunk = useCallback(
    async ({ blob, sequenceNumber, timestamp, mimeType }: { blob: Blob; sequenceNumber: number; timestamp: number; mimeType: string }) => {
      if (!sessionId || !queueRef.current) {
        return
      }

      await queueRef.current.addChunk({
        roomId,
        sessionId,
        participantId,
        participantName,
        role,
        trackType,
        sequenceNumber,
        timestamp,
        mimeType,
        chunkBlob: blob,
      })
    },
    [participantId, participantName, role, roomId, sessionId],
  )

  const onRecorderStop = useCallback(async () => {
    setStatus('uploading')
    await handleFinalizeUploads()
  }, [handleFinalizeUploads])

  // Guest: Standard chunked recorder (records own stream)
  const { isRecording: isGuestRecording, elapsedSeconds: guestSeconds, start: startGuestRecorder, stop: stopGuestRecorder } = useChunkedRecorder({
    onChunk: handleRecorderChunk,
    onStop: onRecorderStop,
  })

  // Host: Mixed recorder (records all streams combined)
  const { 
    mixerReady,
    isRecording: isHostRecording, 
    elapsedSeconds: hostSeconds, 
    start: startHostRecorder, 
    stop: stopHostRecorder,
    changeLayout,
    currentLayout,
  } = useMixedRecorder({
    localStream,
    remoteStreams: remoteStreamsMap,
    localParticipantId: participantId,
    localParticipantName: participantName,
    isHost: role === 'host',
    layout: mixerLayout,
    onChunk: handleRecorderChunk,
    onStop: onRecorderStop,
  })

  const isRecording = role === 'host' ? isHostRecording : isGuestRecording
  const elapsedSeconds = role === 'host' ? hostSeconds : guestSeconds
  
  const startRecorder = useCallback(async (stream?: MediaStream) => {
    if (role === 'host') {
      await startHostRecorder(appConfig.chunkIntervalMs)
    } else {
      const mediaStream = stream ?? localStream ?? (await requestMedia())
      if (!mediaStream) {
        throw new Error('No media stream available')
      }
      await startGuestRecorder(mediaStream, appConfig.chunkIntervalMs)
    }
  }, [role, startHostRecorder, startGuestRecorder, localStream, requestMedia])

  const stopRecorder = useCallback(() => {
    if (role === 'host') {
      stopHostRecorder()
    } else {
      stopGuestRecorder()
    }
  }, [role, stopHostRecorder, stopGuestRecorder])

  const handleCopyInviteLink = useCallback(async () => {
    const invitePath = `/join?roomId=${encodeURIComponent(roomId)}`
    const inviteUrl = typeof window !== 'undefined' ? `${window.location.origin}${invitePath}` : invitePath

    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setInviteCopyState('error')
      return
    }

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setInviteCopyState('copied')
    } catch {
      setInviteCopyState('error')
    }

    window.setTimeout(() => {
      setInviteCopyState('idle')
    }, 2000)
  }, [roomId])

  const handleTeleprompterWheel = useCallback((deltaY: number) => {
    const teleprompterPanel = teleprompterScrollRef.current
    if (!teleprompterPanel) {
      return
    }

    teleprompterPanel.scrollTop += deltaY * teleprompterScrollSpeed
  }, [teleprompterScrollSpeed])

  useEffect(() => {
    if (!isTeleprompterEnabled || !isTeleprompterAutoScrollEnabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      const teleprompterPanel = teleprompterScrollRef.current
      if (!teleprompterPanel) {
        return
      }

      const maxScrollTop = teleprompterPanel.scrollHeight - teleprompterPanel.clientHeight
      const nextScrollTop = Math.min(maxScrollTop, teleprompterPanel.scrollTop + teleprompterScrollSpeed)

      teleprompterPanel.scrollTop = nextScrollTop

      if (nextScrollTop >= maxScrollTop) {
        setIsTeleprompterAutoScrollEnabled(false)
      }
    }, 16)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isTeleprompterAutoScrollEnabled, isTeleprompterEnabled, teleprompterScrollSpeed])

  const {
    connected,
    joined,
    joining,
    joinPendingApproval,
    joinError,
    remoteUser,
    remoteStream,
    uploadProgressMap,
    joinRoom,
    leaveRoom,
    approveGuestJoin,
    emitHostStartRecording,
    emitHostStopRecording,
    emitUploadProgress,
  } = useRoomSignaling({
    serverUrl: appConfig.serverUrl,
    roomId,
    participantId,
    participantName,
    participantNameStyle,
    role,
    localStream,
    onHostStartRecording: async ({ sessionId: nextSessionId, chunkIntervalMs }) => {
      // Mixed recording (host records all): only guests receive this, and should NOT record individually
      // Legacy individual recording: all participants receive this and record themselves
      // For now, with mixed recording, guests don't start recording here
      if (role === 'guest') {
        // In mixed mode, guests don't record. This callback can be ignored or used for UI feedback.
        return
      }
    },
    onHostStopRecording: () => {
      if (role === 'guest') {
        return
      }
    },
    onGuestJoinRequest: ({ guestSocketId, participantId: nextParticipantId, name, nameStyle }) => {
      if (role !== 'host') {
        return
      }

      setPendingGuestJoin({
        guestSocketId,
        participantId: nextParticipantId,
        name,
        nameStyle,
      })
    },
    onGuestJoinCancelled: ({ guestSocketId }) => {
      setPendingGuestJoin((currentRequest) => {
        if (!currentRequest || currentRequest.guestSocketId !== guestSocketId) {
          return currentRequest
        }

        return null
      })
    },
  })

  // Update remote stream mapping when remote stream changes
  useEffect(() => {
    if (remoteUser && remoteStream) {
      setRemoteStreamsMap((prev) => {
        const next = new Map(prev)
        next.set(remoteUser.participantId, {
          stream: remoteStream,
          name: remoteUser.name,
        })
        return next
      })
    }
  }, [remoteUser, remoteStream])

  const ensureRoomExists = useCallback(async () => {
    try {
      await getRoom(roomId)
      setRoomError(null)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Room does not exist')
    }
  }, [roomId])

  useEffect(() => {
    void ensureRoomExists()
  }, [ensureRoomExists])

  useEffect(() => {
    const cachedSessionId = getActiveSession(roomId, participantId)
    if (!cachedSessionId) {
      return
    }

    const queue = new ChunkUploadQueue({
      serverUrl: appConfig.serverUrl,
      roomId,
      sessionId: cachedSessionId,
      participantId,
      trackType,
      onStateChange: (next) => {
        setQueueState(next)
        emitUploadProgress({
          participantId,
          uploadedChunks: next.uploadedChunks,
          pendingChunks: next.pendingChunks,
          failedChunks: next.failedChunks,
          retrying: next.retrying,
        })
      },
    })

    queueRef.current = queue
    setSessionId(cachedSessionId)
    setStatus('uploading')
    void queue.hydrate()
  }, [emitUploadProgress, participantId, roomId])

  useEffect(() => {
    const onOnline = () => queueRef.current?.resume()
    const onOffline = () => queueRef.current?.pause()

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queueRef.current?.hasPendingChunks()) {
        return
      }

      event.preventDefault()
      event.returnValue = 'Uploads are still pending.'
    }

    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  useEffect(() => {
    if (status !== 'uploading' || isRecording || !sessionId || isFinalizing) {
      return
    }

    if (queueState.pendingChunks === 0) {
      void handleFinalizeUploads()
    }
  }, [handleFinalizeUploads, isFinalizing, isRecording, queueState.pendingChunks, sessionId, status])

  const handleConnectClick = async () => {
    const media = localStream ?? (await requestMedia())
    if (!media) {
      return
    }

    joinRoom()
    setStatus('connected')
  }

  const startRecordingAsHost = async () => {
    if (role !== 'host') {
      return
    }

    const media = localStream ?? (await requestMedia())
    if (!media) {
      return
    }

    try {
      const response = await startSession({
        roomId,
        hostParticipantId: participantId,
        hostName: participantName,
      })

      const nextSessionId = response.session.id
      hostSessionCompletedRef.current = false
      setSessionId(nextSessionId)
      saveActiveSession(roomId, participantId, nextSessionId)

      const queue = new ChunkUploadQueue({
        serverUrl: appConfig.serverUrl,
        roomId,
        sessionId: nextSessionId,
        participantId,
        trackType,
        onStateChange: (next) => {
          setQueueState(next)
          emitUploadProgress({
            participantId,
            uploadedChunks: next.uploadedChunks,
            pendingChunks: next.pendingChunks,
            failedChunks: next.failedChunks,
            retrying: next.retrying,
          })
        },
      })

      queueRef.current = queue
      await queue.hydrate()

      // For mixed recording, no need to emit to guests to start recording
      // Host records mixed stream only

      setStatus('recording')
      await startRecorder()
    } catch (error) {
      setStatus('upload-failed')
      setFinalizationError(error instanceof Error ? error.message : 'Could not start recording session.')
    }
  }

  const stopRecordingAsHost = () => {
    if (role !== 'host') {
      return
    }

    emitHostStopRecording()
    stopRecorder()
  }

  const handleGuestJoinDecision = useCallback(
    (approved: boolean) => {
      if (!pendingGuestJoin) {
        return
      }

      approveGuestJoin(pendingGuestJoin.guestSocketId, approved)
      setPendingGuestJoin(null)
    },
    [approveGuestJoin, pendingGuestJoin],
  )

  useEffect(() => {
    if (remoteUser) {
      setPendingGuestJoin(null)
    }
  }, [remoteUser])

  const localDisplayName = useMemo(
    () => styleDisplayName(participantName, participantNameStyle),
    [participantName, participantNameStyle],
  )
  const remoteDisplayName = useMemo(() => {
    if (!remoteUser) {
      return 'Waiting for guest...'
    }

    return styleDisplayName(remoteUser.name, remoteUser.nameStyle)
  }, [remoteUser])

  const localProgress = uploadProgressMap[participantId] ?? {
    roomId,
    participantId,
    uploadedChunks: queueState.uploadedChunks,
    pendingChunks: queueState.pendingChunks,
    failedChunks: queueState.failedChunks,
    retrying: queueState.retrying,
  }

  const remoteProgress = remoteUser ? uploadProgressMap[remoteUser.participantId] ?? null : null
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine

  return (
    <section className="space-y-4">
      {role === 'host' && isTeleprompterEnabled ? (
        <section className="sticky top-3 z-30 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-glass">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-100">Teleprompter</p>
            <p className="text-xs text-slate-400">Use mouse wheel over script to move up/down</p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-300">
              Font size: {teleprompterFontSize}px
              <input
                type="range"
                min={20}
                max={64}
                step={1}
                value={teleprompterFontSize}
                onChange={(event) => setTeleprompterFontSize(Number(event.target.value))}
                className="mt-1 w-full"
              />
            </label>

            <label className="text-xs text-slate-300">
              Scroll speed: {teleprompterScrollSpeed.toFixed(2)}x
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.25}
                value={teleprompterScrollSpeed}
                onChange={(event) => setTeleprompterScrollSpeed(Number(event.target.value))}
                className="mt-1 w-full"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsTeleprompterAutoScrollEnabled((previousValue) => !previousValue)}
            >
              {isTeleprompterAutoScrollEnabled ? 'Pause Auto-scroll' : 'Start Auto-scroll'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsTeleprompterAutoScrollEnabled(false)
                if (teleprompterScrollRef.current) {
                  teleprompterScrollRef.current.scrollTop = 0
                }
              }}
            >
              Reset to top
            </Button>
            <p className="text-xs text-slate-400">Auto-scroll uses current scroll speed.</p>
          </div>

          <textarea
            value={teleprompterText}
            onChange={(event) => setTeleprompterText(event.target.value)}
            placeholder="Write your script here..."
            className="mt-3 h-28 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
          />

          <div
            ref={teleprompterScrollRef}
            className="mt-3 max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-4 py-3 leading-relaxed text-white"
            style={{ fontSize: `${teleprompterFontSize}px` }}
            onWheel={(event) => {
              event.preventDefault()
              handleTeleprompterWheel(event.deltaY)
            }}
          >
            {teleprompterText || 'Your teleprompter script will appear here.'}
          </div>
        </section>
      ) : null}

      <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-glass">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-300">Room {roomId}</p>
            <p className="text-lg font-semibold text-white">
              {localDisplayName} ({role})
            </p>
            <p className="text-sm text-slate-400">
              {connected ? 'Socket connected' : 'Socket connecting'} · {joined ? 'Joined room' : 'Not joined yet'}
            </p>
          </div>

          <StatusBadge status={status} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void requestMedia()}>
            Enable Camera + Mic
          </Button>
          <Button onClick={() => void handleConnectClick()} disabled={!connected || joined || joining || joinPendingApproval}>
            {joining ? 'Joining...' : joinPendingApproval ? 'Waiting for host approval...' : 'Join Room'}
          </Button>
          <Button variant="secondary" onClick={leaveRoom} disabled={!joined}>
            Leave Room
          </Button>

          {role === 'host' ? (
            <>
              <Button onClick={() => void startRecordingAsHost()} disabled={!joined || isRecording}>
                Start Mixed Recording
              </Button>
              <Button variant="danger" onClick={stopRecordingAsHost} disabled={!isRecording}>
                Stop Recording
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setIsTeleprompterEnabled((previousValue) => {
                    const nextValue = !previousValue
                    if (!nextValue) {
                      setIsTeleprompterAutoScrollEnabled(false)
                    }
                    return nextValue
                  })
                }}
              >
                {isTeleprompterEnabled ? 'Disable Teleprompter' : 'Enable Teleprompter'}
              </Button>

              {isRecording && (
                <div className="flex gap-2">
                  <select
                    value={mixerLayout}
                    onChange={(e) => {
                      setMixerLayout(e.target.value as StreamMixerLayout)
                      changeLayout(e.target.value as StreamMixerLayout)
                    }}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white border border-white/10"
                  >
                    <option value="side-by-side">Side-by-side layout</option>
                    <option value="grid">Grid layout</option>
                    <option value="speaker-focus">Speaker focus</option>
                  </select>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">Waiting for host to start recording...</p>
          )}

          {status === 'upload-failed' ? (
            <Button variant="danger" onClick={() => void handleFinalizeUploads()} disabled={isFinalizing}>
              Retry finalize
            </Button>
          ) : null}
        </div>

        {joinPendingApproval ? (
          <p className="mt-3 text-sm text-brand-200">Join request sent. Waiting for host approval.</p>
        ) : null}

        {role === 'host' && pendingGuestJoin ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Guest wants to join</p>
            <p className="mt-1 text-slate-300">
              {styleDisplayName(pendingGuestJoin.name, pendingGuestJoin.nameStyle)}
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" onClick={() => handleGuestJoinDecision(true)}>
                Allow guest
              </Button>
              <Button type="button" variant="danger" onClick={() => handleGuestJoinDecision(false)}>
                Deny
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
          <p>Recording timer: {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}</p>
          <p>
            Upload queue: {queueState.pendingChunks} pending, {queueState.failedChunks} failed attempts
          </p>
        </div>

        {roomError ? <p className="mt-3 text-sm text-rose-300">{roomError}</p> : null}
        {mediaError ? <p className="mt-3 text-sm text-rose-300">{mediaError}</p> : null}
        {joinError ? <p className="mt-3 text-sm text-rose-300">{joinError}</p> : null}
        {finalizationError ? <p className="mt-3 text-sm text-rose-300">{finalizationError}</p> : null}

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300">
          <p className="font-semibold text-slate-200">Add guest to this room</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-all text-brand-300">
              {typeof window !== 'undefined'
                ? `${window.location.origin}/join?roomId=${encodeURIComponent(roomId)}`
                : `/join?roomId=${encodeURIComponent(roomId)}`}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => void handleCopyInviteLink()}
            >
              Copy guest link
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Share this link to let one guest join this room: {roomId}</p>
          {inviteCopyState === 'copied' ? <p className="mt-1 text-xs text-emerald-300">Invite link copied.</p> : null}
          {inviteCopyState === 'error' ? (
            <p className="mt-1 text-xs text-rose-300">Couldn&apos;t copy automatically. Copy the link manually.</p>
          ) : null}
        </div>
      </article>

      <section className="grid gap-4 lg:grid-cols-2">
        <VideoTile title={`${localDisplayName} (local)`} stream={localStream} muted />
        <VideoTile title={remoteUser ? `${remoteDisplayName} (remote)` : 'Waiting for guest...'} stream={remoteStream} />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {role === 'host' ? (
          <>
            <UploadProgressCard title="Mixed recording upload" progress={localProgress} />
            {remoteUser && <UploadProgressCard title={`${remoteDisplayName}'s stream received`} progress={remoteProgress} />}
          </>
        ) : (
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-200">Mixed Recording Mode</p>
            <p className="mt-2">
              The host is recording a combined stream with all participants' audio and video. Your local stream is being sent to the host for mixing.
              You do not upload individual recordings.
            </p>
          </div>
        )}
      </section>

      <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300">
        <p>Session ID: {sessionId ?? 'Not started'}</p>
        <p className="mt-1">Network: {isOnline ? 'Online' : 'Offline'}</p>
        <p className="mt-1">Retrying uploads: {queueState.retrying ? 'Yes' : 'No'}</p>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={stopMedia}>
          Turn off camera/mic
        </Button>
      </div>
    </section>
  )
}
