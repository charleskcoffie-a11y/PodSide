'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderChunk = {
  blob: Blob
  sequenceNumber: number
  timestamp: number
  mimeType: string
}

type RecorderCallbacks = {
  onChunk: (chunk: RecorderChunk) => Promise<void> | void
  onStop?: () => Promise<void> | void
}

const preferredMimeTypes = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'audio/webm',
]

const selectSupportedMimeType = () => {
  for (const candidate of preferredMimeTypes) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }

  return ''
}

export const useChunkedRecorder = ({ onChunk, onStop }: RecorderCallbacks) => {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const sequenceRef = useRef(1)
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const start = useCallback(
    async (stream: MediaStream, chunkIntervalMs: number) => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        return
      }

      const mimeType = selectSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      sequenceRef.current = 1
      startedAtRef.current = Date.now()
      setElapsedSeconds(0)

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) {
          return
        }

        const payload: RecorderChunk = {
          blob: event.data,
          sequenceNumber: sequenceRef.current,
          timestamp: Date.now() - startedAtRef.current,
          mimeType: recorder.mimeType || event.data.type || 'video/webm',
        }

        sequenceRef.current += 1
        void onChunk(payload)
      }

      recorder.onstop = () => {
        clearTimer()
        setIsRecording(false)
        void onStop?.()
      }

      recorder.start(chunkIntervalMs)
      recorderRef.current = recorder
      setIsRecording(true)

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 1000)
    },
    [onChunk, onStop],
  )

  const stop = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      return
    }

    recorderRef.current.stop()
  }, [])

  useEffect(() => {
    return () => {
      clearTimer()
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    }
  }, [])

  return {
    isRecording,
    elapsedSeconds,
    start,
    stop,
  }
}
