export type ParticipantRole = 'host' | 'guest'
export type NameStyle = 'classic' | 'uppercase' | 'highlight'

export type SessionStatus =
  | 'connected'
  | 'recording'
  | 'uploading'
  | 'completed'
  | 'upload-failed'

export type RoomUser = {
  id: string
  participantId: string
  name: string
  nameStyle: NameStyle
  role: ParticipantRole
}

export type UploadProgress = {
  roomId: string
  participantId: string
  uploadedChunks: number
  pendingChunks: number
  failedChunks: number
  retrying: boolean
}

export type ChunkUploadPayload = {
  roomId: string
  sessionId: string
  participantId: string
  participantName: string
  role: ParticipantRole
  trackType: string
  sequenceNumber: number
  timestamp: number
  mimeType: string
  chunkBlob: Blob
}

export type SessionSummary = {
  id: string
  roomId: string
  status: string
  startedAt: string | null
  endedAt: string | null
  manifestPath: string | null
  participants: {
    id: string
    externalId: string
    name: string
    role: 'HOST' | 'GUEST'
    status: string
  }[]
  totalTracks: number
  totalChunks: number
  trackFiles: {
    trackId: string
    participantName: string
    participantId: string
    trackType: string
    finalFilePath: string | null
    chunkCount: number
    uploadCompleted: boolean
  }[]
}

export type SessionDetail = {
  id: string
  roomId: string
  status: string
  startedAt: string | null
  endedAt: string | null
  manifestPath: string | null
  participants: {
    id: string
    externalId: string
    name: string
    role: 'HOST' | 'GUEST'
    status: string
    tracks: {
      id: string
      trackType: string
      mimeType: string
      status: string
      uploadCompleted: boolean
      lastSequence: number
      finalFilePath: string | null
      startedAt: string | null
      endedAt: string | null
      chunks: {
        id: string
        sequenceNumber: number
        timestamp: string
        sizeBytes: number
        mimeType: string
        filePath: string
      }[]
    }[]
  }[]
}
