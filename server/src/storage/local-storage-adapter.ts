import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sanitizeSegment } from '../utils/identifiers.js'
import {
  type RecordingStorageAdapter,
  type WriteCombinedTrackInput,
  type WriteCombinedTrackResult,
  type SaveChunkInput,
  type SaveChunkResult,
  type WriteManifestInput,
  type WriteManifestResult,
} from './storage-adapter.js'

const toPosix = (value: string) => value.replace(/\\/g, '/')

export class LocalRecordingStorageAdapter implements RecordingStorageAdapter {
  constructor(private readonly baseDirectory: string) {}

  async saveChunk(input: SaveChunkInput): Promise<SaveChunkResult> {
    const folder = path.join(
      this.baseDirectory,
      sanitizeSegment(input.roomCode),
      sanitizeSegment(input.sessionId),
      sanitizeSegment(input.participantId),
      sanitizeSegment(input.trackType),
    )

    await mkdir(folder, { recursive: true })

    const fileName = `chunk-${String(input.sequenceNumber).padStart(5, '0')}${input.extension}`
    const absolutePath = path.join(folder, fileName)
    await writeFile(absolutePath, input.buffer)

    return {
      absolutePath,
      relativePath: toPosix(path.relative(this.baseDirectory, absolutePath)),
      fileName,
    }
  }

  async writeManifest(input: WriteManifestInput): Promise<WriteManifestResult> {
    const folder = path.join(
      this.baseDirectory,
      sanitizeSegment(input.roomCode),
      sanitizeSegment(input.sessionId),
    )

    await mkdir(folder, { recursive: true })

    const absolutePath = path.join(folder, 'manifest.json')
    await writeFile(absolutePath, JSON.stringify(input.manifest, null, 2), 'utf-8')

    return {
      absolutePath,
      relativePath: toPosix(path.relative(this.baseDirectory, absolutePath)),
    }
  }

  async writeCombinedTrack(input: WriteCombinedTrackInput): Promise<WriteCombinedTrackResult> {
    const folder = path.join(
      this.baseDirectory,
      sanitizeSegment(input.roomCode),
      sanitizeSegment(input.sessionId),
      sanitizeSegment(input.participantId),
      sanitizeSegment(input.trackType),
    )

    await mkdir(folder, { recursive: true })

    const absolutePath = path.join(folder, `final-raw${input.extension}`)
    await writeFile(absolutePath, Buffer.concat(input.chunks))

    return {
      absolutePath,
      relativePath: toPosix(path.relative(this.baseDirectory, absolutePath)),
    }
  }

  async readRelativeFile(relativePath: string): Promise<Buffer> {
    const absolutePath = path.join(this.baseDirectory, relativePath)
    return readFile(absolutePath)
  }

  async deleteRelativeFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(this.baseDirectory, relativePath)
    await rm(absolutePath, { force: true })
  }
}
