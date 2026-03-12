'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { StreamMixer, type StreamMixerLayout } from '@/lib/mixer/stream-mixer'
import { useChunkedRecorder, type RecorderChunk } from './use-chunked-recorder'

export type UseMixedRecorderOptions = {
  localStream: MediaStream | null
  remoteStreams: Map<string, { stream: MediaStream; name: string }> // participantId -> {stream, name}
  localParticipantId: string
  localParticipantName: string
  isHost: boolean
  layout?: StreamMixerLayout
  onChunk?: (chunk: RecorderChunk) => Promise<void> | void
  onStop?: () => Promise<void> | void
}

/**
 * Hook for mixing multiple participant streams and recording the combined output.
 * Only used on the host side.
 */
export const useMixedRecorder = ({
  localStream,
  remoteStreams,
  localParticipantId,
  localParticipantName,
  isHost,
  layout = 'side-by-side',
  onChunk,
  onStop,
}: UseMixedRecorderOptions) => {
  const mixerRef = useRef<StreamMixer | null>(null)
  const mixedStreamRef = useRef<MediaStream | null>(null)
  const [mixerReady, setMixerReady] = useState(false)
  const [currentLayout, setCurrentLayout] = useState<StreamMixerLayout>(layout)

  // Use the standard chunked recorder for the mixed stream
  const {
    isRecording,
    elapsedSeconds,
    start: startChunkedRecorder,
    stop: stopChunkedRecorder,
  } = useChunkedRecorder({
    onChunk: onChunk || (() => {}),
    onStop: onStop,
  })

  // Initialize the mixer
  useEffect(() => {
    if (!isHost) {
      setMixerReady(false)
      return
    }

    const mixer = new StreamMixer({ layout: currentLayout })
    mixerRef.current = mixer

    // Add local stream
    if (localStream) {
      mixer.addStream(localStream, localParticipantId, localParticipantName)
    }

    // Add all remote streams
    for (const [participantId, { stream, name }] of remoteStreams.entries()) {
      mixer.addStream(stream, participantId, name)
    }

    setMixerReady(true)

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stop()
        mixerRef.current = null
      }
      mixedStreamRef.current = null
    }
  }, [isHost, localStream, remoteStreams, localParticipantId, localParticipantName, currentLayout])

  // Start mixing streams and recording
  const start = useCallback(
    async (chunkIntervalMs: number) => {
      if (!mixerRef.current || !isHost) {
        throw new Error('Mixer not ready or not host')
      }

      // Start the mixer
      const mixedStream = await mixerRef.current.start()
      mixedStreamRef.current = mixedStream

      // Start recording the mixed stream
      await startChunkedRecorder(mixedStream, chunkIntervalMs)
    },
    [isHost, startChunkedRecorder],
  )

  // Stop recording
  const stop = useCallback(() => {
    stopChunkedRecorder()
    if (mixerRef.current) {
      mixerRef.current.stop()
    }
  }, [stopChunkedRecorder])

  // Change layout at runtime
  const changeLayout = useCallback((newLayout: StreamMixerLayout) => {
    setCurrentLayout(newLayout)
    if (mixerRef.current) {
      mixerRef.current.setLayout(newLayout)
    }
  }, [])

  // Get RTT from peer connection and set latency buffer
  const setLatencyFromRTT = useCallback(async (rttMs: number) => {
    if (mixerRef.current) {
      await mixerRef.current.measureAndSetLatency(rttMs)
    }
  }, [])

  return {
    mixerReady,
    isRecording,
    elapsedSeconds,
    start,
    stop,
    changeLayout,
    currentLayout,
    setLatencyFromRTT,
  }
}
