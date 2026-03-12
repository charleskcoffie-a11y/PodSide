import type { ParticipantRole } from '../types'

const DB_NAME = 'podside-upload-queue'
const DB_VERSION = 1
const STORE_NAME = 'chunks'

export type PersistedChunkRecord = {
  id: string
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
  attempts: number
  createdAt: number
}

const canUseIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window

const openDb = async () => {
  if (!canUseIndexedDb()) {
    return null
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId', { unique: false })
        store.createIndex('participantId', 'participantId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> => {
  const db = await openDb()
  if (!db) {
    return null
  }

  const transaction = db.transaction(STORE_NAME, mode)
  const store = transaction.objectStore(STORE_NAME)

  try {
    const result = await run(store)
    return result
  } finally {
    db.close()
  }
}

export const persistChunkRecord = async (record: PersistedChunkRecord) => {
  await withStore('readwrite',
    (store) =>
      new Promise<void>((resolve, reject) => {
        const request = store.put(record)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      }),
  )
}

export const deleteChunkRecord = async (id: string) => {
  await withStore('readwrite',
    (store) =>
      new Promise<void>((resolve, reject) => {
        const request = store.delete(id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      }),
  )
}

export const listChunkRecords = async (filter?: {
  roomId?: string
  sessionId?: string
  participantId?: string
  trackType?: string
}) => {
  const records =
    (await withStore('readonly',
      (store) =>
        new Promise<PersistedChunkRecord[]>((resolve, reject) => {
          const request = store.getAll()
          request.onsuccess = () => {
            const list = request.result as PersistedChunkRecord[]
            resolve(list)
          }
          request.onerror = () => reject(request.error)
        }),
    )) ?? []

  return records
    .filter((entry) => {
      if (filter?.roomId && entry.roomId !== filter.roomId) {
        return false
      }
      if (filter?.sessionId && entry.sessionId !== filter.sessionId) {
        return false
      }
      if (filter?.participantId && entry.participantId !== filter.participantId) {
        return false
      }
      if (filter?.trackType && entry.trackType !== filter.trackType) {
        return false
      }

      return true
    })
    .sort((first, second) => first.sequenceNumber - second.sequenceNumber)
}

export const clearChunkRecords = async (filter?: {
  roomId?: string
  sessionId?: string
  participantId?: string
  trackType?: string
}) => {
  const records = await listChunkRecords(filter)
  await Promise.all(records.map((entry) => deleteChunkRecord(entry.id)))
}
