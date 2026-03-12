'use client'

import { useCallback, useRef, useState } from 'react'

export const useMediaStream = () => {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const requestMedia = useCallback(async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      })

      streamRef.current = media
      setStream(media)
      setError(null)
      return media
    } catch {
      setError('Camera/microphone permission was denied or unavailable.')
      return null
    }
  }, [])

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  return {
    stream,
    error,
    requestMedia,
    stopMedia,
  }
}
