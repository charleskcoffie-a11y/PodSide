export const sanitizeSegment = (value: string) => value.trim().replace(/[^a-zA-Z0-9-_]/g, '_')

export const createRoomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const size = 6
  let result = ''

  for (let index = 0; index < size; index += 1) {
    const random = Math.floor(Math.random() * alphabet.length)
    result += alphabet[random]
  }

  return result
}

export const toTrackType = (raw: string) => sanitizeSegment(raw || 'camera-mic').toLowerCase()
