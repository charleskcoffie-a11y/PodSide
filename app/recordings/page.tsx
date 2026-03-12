'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { listSessions } from '@/lib/api-client'
import { appConfig } from '@/lib/config'
import type { SessionSummary } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

const toRecordingUrl = (filePath: string) =>
  filePath.startsWith('http://') || filePath.startsWith('https://')
    ? filePath
    : `${appConfig.serverUrl}/recordings/${filePath}`

export default function RecordingsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const response = await listSessions()
        setSessions(response.sessions)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load sessions')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  if (loading) {
    return <p className="text-sm text-slate-300">Loading sessions...</p>
  }

  if (error) {
    return <p className="text-sm text-rose-300">{error}</p>
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Recordings</h2>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300">
          No sessions yet. Record one from a room.
        </p>
      ) : (
        <ul className="grid gap-4">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-glass">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm uppercase tracking-wide text-brand-300">Room {session.roomId}</p>
                  <p className="text-lg font-semibold text-white">Session {session.id}</p>
                </div>

                <Link
                  href={`/recordings/${session.id}`}
                  className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
                >
                  Open session
                </Link>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                <p>Status: {session.status}</p>
                <p>Started: {formatDateTime(session.startedAt)}</p>
                <p>Ended: {formatDateTime(session.endedAt)}</p>
                <p>Total chunks: {session.totalChunks}</p>
              </div>

              <div className="mt-3 space-y-2 text-sm">
                {session.trackFiles.map((track) => (
                  <div key={track.trackId} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                    <p className="text-slate-200">
                      {track.participantName} · {track.trackType} · {track.chunkCount} chunks
                    </p>
                    {track.finalFilePath ? (
                      <a
                        href={toRecordingUrl(track.finalFilePath)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-brand-300"
                      >
                        Download participant raw file
                      </a>
                    ) : (
                      <p className="mt-1 text-slate-500">Final file not available yet.</p>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
