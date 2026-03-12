export type SaveChunkInput = {
  roomCode: string
  sessionId: string
  participantId: string
  trackType: string
  sequenceNumber: number
  extension: string
  buffer: Buffer
}

export type SaveChunkResult = {
  absolutePath: string
  relativePath: string
  fileName: string
}

export type WriteManifestInput = {
  roomCode: string
  sessionId: string
  manifest: object
}

export type WriteManifestResult = {
  absolutePath: string
  relativePath: string
}

export type WriteCombinedTrackInput = {
  roomCode: string
  sessionId: string
  participantId: string
  trackType: string
  extension: string
  chunks: Buffer[]
}

export type WriteCombinedTrackResult = {
  absolutePath: string
  relativePath: string
}

export interface RecordingStorageAdapter {
  saveChunk(input: SaveChunkInput): Promise<SaveChunkResult>
  writeManifest(input: WriteManifestInput): Promise<WriteManifestResult>
  writeCombinedTrack(input: WriteCombinedTrackInput): Promise<WriteCombinedTrackResult>
  readRelativeFile(relativePath: string): Promise<Buffer>
  deleteRelativeFile(relativePath: string): Promise<void>
}

// TODO: Add S3 adapter implementation with multipart uploads and resumable chunk commits.
