const roomKey = (roomId: string, participantId: string) => `podside:active-session:${roomId}:${participantId}`

export const saveActiveSession = (roomId: string, participantId: string, sessionId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(roomKey(roomId, participantId), sessionId)
}

export const getActiveSession = (roomId: string, participantId: string) => {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(roomKey(roomId, participantId))
}

export const clearActiveSession = (roomId: string, participantId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(roomKey(roomId, participantId))
}
