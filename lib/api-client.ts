import { appConfig } from './config'
import type { SessionDetail, SessionSummary } from './types'

type JsonResponse<T> = {
  ok: boolean
  error?: string
} & T

const asJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

export const createRoom = async (roomCode?: string) => {
  return asJson<
    JsonResponse<{
      room: {
        roomId: string
        code: string
      }
    }>
  >(
    await fetch(`${appConfig.serverUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode }),
    }),
  )
}

export const getRoom = async (roomId: string) => {
  return asJson<
    JsonResponse<{
      room: {
        id: string
        roomId: string
        code: string
        status: string
      }
    }>
  >(await fetch(`${appConfig.serverUrl}/api/rooms/${roomId}`))
}

export const startSession = async (payload: {
  roomId: string
  hostParticipantId: string
  hostName: string
}) => {
  return asJson<
    JsonResponse<{
      session: {
        id: string
        roomId: string
        status: string
      }
    }>
  >(
    await fetch(`${appConfig.serverUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export const completeSession = async (sessionId: string) => {
  return asJson<
    JsonResponse<{
      session: {
        id: string
        roomId: string
        status: string
        manifestPath: string | null
      }
    }>
  >(
    await fetch(`${appConfig.serverUrl}/api/sessions/${sessionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
}

export const listSessions = async () => {
  return asJson<JsonResponse<{ sessions: SessionSummary[] }>>(
    await fetch(`${appConfig.serverUrl}/api/sessions`, { cache: 'no-store' }),
  )
}

export const getSession = async (sessionId: string) => {
  return asJson<JsonResponse<{ session: SessionDetail }>>(
    await fetch(`${appConfig.serverUrl}/api/sessions/${sessionId}`, { cache: 'no-store' }),
  )
}

export const finalizeTrackUpload = async (payload: {
  roomId: string
  sessionId: string
  participantId: string
  trackType: string
}) => {
  return asJson<
    JsonResponse<{
      manifestPath: string
      sessionStatus: string
      finalFilePath: string
    }>
  >(
    await fetch(`${appConfig.serverUrl}/api/uploads/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}
