import type { ChunkUploadPayload } from '../types'
import {
  deleteChunkRecord,
  listChunkRecords,
  persistChunkRecord,
  type PersistedChunkRecord,
} from './indexeddb'

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs))

export type QueueState = {
  pendingChunks: number
  uploadedChunks: number
  failedChunks: number
  retrying: boolean
  lastError: string | null
}

type QueueOptions = {
  serverUrl: string
  roomId: string
  sessionId: string
  participantId: string
  trackType: string
  onStateChange?: (state: QueueState) => void
}

const toQueueId = (payload: ChunkUploadPayload) =>
  `${payload.sessionId}:${payload.participantId}:${payload.trackType}:${payload.sequenceNumber}`

const parseErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string }
    return payload.error ?? `Upload failed with status ${response.status}`
  } catch {
    return `Upload failed with status ${response.status}`
  }
}

export class ChunkUploadQueue {
  private queue: PersistedChunkRecord[] = []
  private processing = false
  private paused = false
  private state: QueueState = {
    pendingChunks: 0,
    uploadedChunks: 0,
    failedChunks: 0,
    retrying: false,
    lastError: null,
  }

  constructor(private readonly options: QueueOptions) {}

  async hydrate() {
    const records = await listChunkRecords({
      roomId: this.options.roomId,
      sessionId: this.options.sessionId,
      participantId: this.options.participantId,
      trackType: this.options.trackType,
    })

    this.queue = records
    this.updatePendingState()
    this.kick()
  }

  getState() {
    return this.state
  }

  hasPendingChunks() {
    return this.queue.length > 0 || this.processing
  }

  pause() {
    this.paused = true
    this.state.retrying = false
    this.emit()
  }

  resume() {
    this.paused = false
    this.kick()
  }

  async addChunk(payload: ChunkUploadPayload) {
    const record: PersistedChunkRecord = {
      id: toQueueId(payload),
      roomId: payload.roomId,
      sessionId: payload.sessionId,
      participantId: payload.participantId,
      participantName: payload.participantName,
      role: payload.role,
      trackType: payload.trackType,
      sequenceNumber: payload.sequenceNumber,
      timestamp: payload.timestamp,
      mimeType: payload.mimeType,
      chunkBlob: payload.chunkBlob,
      attempts: 0,
      createdAt: Date.now(),
    }

    await persistChunkRecord(record)
    this.queue.push(record)
    this.queue.sort((first, second) => first.sequenceNumber - second.sequenceNumber)

    this.updatePendingState()
    this.kick()
  }

  async flushAndWait(timeoutMs = 300000) {
    const startedAt = Date.now()

    while (this.processing || this.queue.length > 0) {
      if (Date.now() - startedAt > timeoutMs) {
        return false
      }

      if (!this.paused && navigator.onLine) {
        this.kick()
      }

      await wait(250)
    }

    return true
  }

  private emit() {
    this.options.onStateChange?.(this.state)
  }

  private updatePendingState() {
    this.state.pendingChunks = this.queue.length
    this.emit()
  }

  private async kick() {
    if (this.processing || this.paused || !navigator.onLine) {
      return
    }

    this.processing = true

    try {
      while (!this.paused && this.queue.length > 0 && navigator.onLine) {
        const current = this.queue[0]
        const uploaded = await this.uploadWithRetry(current)

        if (!uploaded) {
          break
        }

        this.queue.shift()
        await deleteChunkRecord(current.id)
        this.state.uploadedChunks += 1
        this.state.retrying = false
        this.state.lastError = null
        this.updatePendingState()
      }
    } finally {
      this.processing = false
      this.emit()
    }
  }

  private async uploadWithRetry(record: PersistedChunkRecord) {
    let attempts = record.attempts

    while (!this.paused && navigator.onLine) {
      try {
        const formData = new FormData()
        formData.append('chunk', record.chunkBlob, `chunk-${record.sequenceNumber}.webm`)
        formData.append('roomId', record.roomId)
        formData.append('sessionId', record.sessionId)
        formData.append('participantId', record.participantId)
        formData.append('participantName', record.participantName)
        formData.append('role', record.role)
        formData.append('trackType', record.trackType)
        formData.append('sequenceNumber', String(record.sequenceNumber))
        formData.append('timestamp', String(record.timestamp))
        formData.append('mimeType', record.mimeType)

        const response = await fetch(`${this.options.serverUrl}/api/uploads/chunk`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        return true
      } catch (error) {
        attempts += 1
        record.attempts = attempts
        await persistChunkRecord(record)

        this.state.failedChunks += 1
        this.state.retrying = true
        this.state.lastError = error instanceof Error ? error.message : 'Upload error'
        this.emit()

        const delay = Math.min(1000 * 2 ** Math.min(attempts, 6), 30000)
        await wait(delay)
      }
    }

    return false
  }
}
