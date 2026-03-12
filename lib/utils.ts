export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) {
    return '—'
  }

  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleString()
}

export const createParticipantId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `participant-${Math.random().toString(36).slice(2)}`
}
