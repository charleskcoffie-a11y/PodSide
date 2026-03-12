'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  stream: MediaStream | null
  muted?: boolean
  className?: string
}

export const VideoTile = ({ title, stream, muted = false, className }: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    videoRef.current.srcObject = stream
  }, [stream])

  return (
    <article className={cn('rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-glass', className)}>
      <p className="mb-2 text-sm font-medium text-slate-200">{title}</p>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="aspect-video w-full rounded-xl bg-slate-950 object-cover"
      />
    </article>
  )
}
