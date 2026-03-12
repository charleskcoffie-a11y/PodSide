'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { getSession } from '@/lib/api-client'
import { appConfig } from '@/lib/config'
import type { SessionDetail } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

const toRecordingUrl = (filePath: string) =>
  filePath.startsWith('http://') || filePath.startsWith('https://')
    ? filePath
    : `${appConfig.serverUrl}/recordings/${filePath}`

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = useMemo(() => params.sessionId, [params.sessionId])

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getSession(sessionId)
        setSession(response.session)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load session details')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [sessionId])

  if (loading) {
    return <p className="text-sm text-slate-300">Loading session details...</p>
  }

  if (error) {
    return <p className="text-sm text-rose-300">{error}</p>
  }

  if (!session) {
    return <p className="text-sm text-slate-300">Session not found.</p>
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-glass">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm uppercase tracking-wide text-brand-300">Room {session.roomId}</p>
            <h2 className="text-xl font-semibold text-white">Session {session.id}</h2>
          </div>

          <Link href="/recordings" className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700">
            Back to recordings
          </Link>
        </div>

        <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          <p>Status: {session.status}</p>
          <p>Started: {formatDateTime(session.startedAt)}</p>
          <p>Ended: {formatDateTime(session.endedAt)}</p>
          <p>Participants: {session.participants.length}</p>
        </div>

        {session.manifestPath ? (
          <a
            href={toRecordingUrl(session.manifestPath)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-brand-300"
          >
            Download manifest.json
          </a>
        ) : null}
      </div>

      <div className="space-y-4">
        {session.participants.map((participant) => (
          <article key={participant.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-glass">
            <h3 className="text-lg font-semibold text-white">
              {participant.name} ({participant.role.toLowerCase()})
            </h3>
            <p className="mt-1 text-sm text-slate-400">Participant ID: {participant.externalId}</p>

            <div className="mt-4 space-y-3">
              {participant.tracks.map((track) => (
                <section key={track.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200">
                      {track.trackType} · {track.status}
                    </p>
                    <p className="text-xs text-slate-400">Chunks: {track.chunks.length}</p>
                  </div>

                  {track.finalFilePath ? (
                    <div className="mt-3 space-y-2">
                      <video controls className="aspect-video w-full rounded-xl bg-slate-950" src={toRecordingUrl(track.finalFilePath)} />
                      <a
                        href={toRecordingUrl(track.finalFilePath)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-sm text-brand-300"
                      >
                        Download final raw file
                      </a>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Final raw file not generated yet.</p>
                  )}

                  <details className="mt-3 rounded-lg border border-white/10 bg-slate-900/60 p-3 text-sm text-slate-300">
                    <summary className="cursor-pointer font-medium text-slate-200">Uploaded chunks</summary>
                    <ul className="mt-2 space-y-1">
                      {track.chunks.map((chunk) => (
                        <li key={chunk.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            Seq {chunk.sequenceNumber} · {Math.round(chunk.sizeBytes / 1024)} KB
                          </span>
                          <a href={toRecordingUrl(chunk.filePath)} target="_blank" rel="noreferrer">
                            Download chunk
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
