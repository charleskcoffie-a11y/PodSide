'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMediaStream } from '@/lib/hooks/use-media-stream'

type Props = {
  title: string
  description: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const DeviceCheckPanel = ({ title, description }: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const [micLevel, setMicLevel] = useState(0)
  const { stream, error, requestMedia, stopMedia } = useMediaStream()

  const hasCamera = Boolean(stream?.getVideoTracks().length)
  const hasMic = Boolean(stream?.getAudioTracks().length)

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    if (!stream || !hasMic) {
      setMicLevel(0)
      return
    }

    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) {
      return
    }

    const audioContext = new AudioContextClass()
    audioContextRef.current = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)

    const samples = new Uint8Array(analyser.fftSize)

    const tick = () => {
      analyser.getByteTimeDomainData(samples)

      let sumSquares = 0
      for (let index = 0; index < samples.length; index += 1) {
        const centered = (samples[index] - 128) / 128
        sumSquares += centered * centered
      }

      const rms = Math.sqrt(sumSquares / samples.length)
      setMicLevel(clamp(rms * 2.8, 0, 1))
      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
      }

      source.disconnect()
      analyser.disconnect()
      setMicLevel(0)

      void audioContext.close()
      audioContextRef.current = null
    }
  }, [hasMic, stream])

  useEffect(() => {
    return () => {
      stopMedia()

      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [stopMedia])

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-100">{title}</p>
          <p className="text-xs text-slate-400">{description}</p>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => void requestMedia()}>
            Test mic/camera
          </Button>
          <Button type="button" variant="secondary" onClick={stopMedia} disabled={!stream}>
            Stop test
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
          <p className="text-xs text-slate-400">Camera</p>
          <p className={hasCamera ? 'text-sm text-emerald-300' : 'text-sm text-slate-300'}>{hasCamera ? 'Detected' : 'Not active'}</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
          <p className="text-xs text-slate-400">Microphone</p>
          <p className={hasMic ? 'text-sm text-emerald-300' : 'text-sm text-slate-300'}>{hasMic ? 'Detected' : 'Not active'}</p>
          <div className="mt-2 h-2 rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-2">
        <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full rounded-lg bg-slate-900 object-cover" />
      </div>

      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </article>
  )
}
