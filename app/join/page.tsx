'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getRoom } from '@/lib/api-client'
import { createParticipantId } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DeviceCheckPanel } from '@/components/room/device-check-panel'
import type { NameStyle } from '@/lib/types'

export default function JoinRoomPage() {
  const router = useRouter()
  const [name, setName] = useState('Guest')
  const [nameStyle, setNameStyle] = useState<NameStyle>('classic')
  const [roomId, setRoomId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [prefilledRoomId, setPrefilledRoomId] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const nextRoomId = params.get('roomId')?.trim().toUpperCase() ?? ''
    const nextGuestName = params.get('name')?.trim() ?? ''
    const nextGuestStyle = params.get('nameStyle')

    if (nextRoomId) {
      setPrefilledRoomId(nextRoomId)
      setRoomId(nextRoomId)
    }

    if (nextGuestName) {
      setName(nextGuestName)
    }

    if (nextGuestStyle === 'classic' || nextGuestStyle === 'uppercase' || nextGuestStyle === 'highlight') {
      setNameStyle(nextGuestStyle)
    }
  }, [])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const normalizedRoomId = roomId.trim().toUpperCase()
      await getRoom(normalizedRoomId)

      const participantId = createParticipantId()
      router.push(
        `/room/${normalizedRoomId}?role=guest&name=${encodeURIComponent(name || 'Guest')}&nameStyle=${encodeURIComponent(nameStyle)}&participantId=${encodeURIComponent(participantId)}`,
      )
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-glass">
      <h2 className="text-xl font-semibold text-white">Join Room</h2>
      <p className="mt-1 text-sm text-slate-300">Join as guest using the room code shared by the host.</p>
      {prefilledRoomId ? <p className="mt-1 text-xs text-brand-300">Invite link detected · Room code is pre-filled.</p> : null}

      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          Guest name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest" required />
        </label>

        <label className="block">
          Guest name style
          <select
            value={nameStyle}
            onChange={(event) => setNameStyle(event.target.value as NameStyle)}
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
          >
            <option value="classic">Classic</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="highlight">Highlight ✨</option>
          </select>
        </label>

        <label className="block">
          Room code
          <input
            value={roomId}
            onChange={(event) => setRoomId(event.target.value.toUpperCase())}
            placeholder="ROOM01"
            required
          />
        </label>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <Button type="submit" variant="secondary" disabled={loading}>
          {loading ? 'Joining...' : 'Join room'}
        </Button>
      </form>

      <div className="mt-5">
        <DeviceCheckPanel
          title="Guest device test"
          description="Test your microphone and camera before joining the room."
        />
      </div>
    </section>
  )
}
