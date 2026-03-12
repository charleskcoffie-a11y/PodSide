'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRoom } from '@/lib/api-client'
import { createParticipantId } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DeviceCheckPanel } from '@/components/room/device-check-panel'
import type { NameStyle } from '@/lib/types'

export default function CreateRoomPage() {
  const router = useRouter()
  const [name, setName] = useState('Host')
  const [nameStyle, setNameStyle] = useState<NameStyle>('classic')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await createRoom(roomCode.trim() || undefined)
      const participantId = createParticipantId()

      router.push(
        `/room/${response.room.roomId}?role=host&name=${encodeURIComponent(name || 'Host')}&nameStyle=${encodeURIComponent(nameStyle)}&participantId=${encodeURIComponent(participantId)}`,
      )
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not create room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-glass">
      <h2 className="text-xl font-semibold text-white">Create Room</h2>
      <p className="mt-1 text-sm text-slate-300">Create one room as host, then add a guest from inside the room.</p>

      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          Host name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Host" required />
        </label>

        <label className="block">
          Host name style
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
          Custom room code (optional)
          <input
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            placeholder="AUTO"
            maxLength={16}
          />
        </label>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <Button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create and join room'}
        </Button>
      </form>

      <div className="mt-5">
        <DeviceCheckPanel
          title="Host device test"
          description="Test your microphone and camera before creating the room."
        />
      </div>
    </section>
  )
}
