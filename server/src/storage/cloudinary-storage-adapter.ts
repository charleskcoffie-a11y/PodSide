import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary'
import { sanitizeSegment } from '../utils/identifiers.js'
import {
  type RecordingStorageAdapter,
  type SaveChunkInput,
  type SaveChunkResult,
  type WriteCombinedTrackInput,
  type WriteCombinedTrackResult,
  type WriteManifestInput,
  type WriteManifestResult,
} from './storage-adapter.js'

type CloudinaryStorageOptions = {
  cloudName: string
  apiKey: string
  apiSecret: string
  uploadFolder: string
}

const stripLeadingDot = (value: string) => value.replace(/^\./, '')

const toPublicIdWithoutExtension = (pathSegment: string) => pathSegment.replace(/\.[^/.]+$/, '')

const parseCloudinaryPublicIdFromUrl = (fileUrl: string) => {
  try {
    const parsedUrl = new URL(fileUrl)
    const match = parsedUrl.pathname.match(/\/upload\/(?:v\d+\/)?(.+)$/)
    if (!match) {
      return null
    }

    return toPublicIdWithoutExtension(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

export class CloudinaryStorageAdapter implements RecordingStorageAdapter {
  constructor(private readonly options: CloudinaryStorageOptions) {
    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: true,
    })
  }

  private buildPublicId(...segments: string[]) {
    const sanitized = segments.map((segment) => sanitizeSegment(segment))
    return [this.options.uploadFolder, ...sanitized].join('/')
  }

  private uploadBuffer(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload failed.'))
          return
        }

        resolve(result)
      })

      stream.end(buffer)
    })
  }

  async saveChunk(input: SaveChunkInput): Promise<SaveChunkResult> {
    const fileName = `chunk-${String(input.sequenceNumber).padStart(5, '0')}${input.extension}`
    const publicId = this.buildPublicId(
      input.roomCode,
      input.sessionId,
      input.participantId,
      input.trackType,
      toPublicIdWithoutExtension(fileName),
    )

    const format = stripLeadingDot(input.extension)
    const uploadResult = await this.uploadBuffer(input.buffer, {
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true,
      format: format || undefined,
      invalidate: true,
    })

    return {
      absolutePath: uploadResult.secure_url,
      relativePath: uploadResult.secure_url,
      fileName,
    }
  }

  async writeManifest(input: WriteManifestInput): Promise<WriteManifestResult> {
    const publicId = this.buildPublicId(input.roomCode, input.sessionId, 'manifest')
    const uploadResult = await this.uploadBuffer(Buffer.from(JSON.stringify(input.manifest, null, 2), 'utf-8'), {
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true,
      format: 'json',
      invalidate: true,
    })

    return {
      absolutePath: uploadResult.secure_url,
      relativePath: uploadResult.secure_url,
    }
  }

  async writeCombinedTrack(input: WriteCombinedTrackInput): Promise<WriteCombinedTrackResult> {
    const fileName = `final-raw${input.extension}`
    const publicId = this.buildPublicId(
      input.roomCode,
      input.sessionId,
      input.participantId,
      input.trackType,
      toPublicIdWithoutExtension(fileName),
    )

    const format = stripLeadingDot(input.extension)
    const uploadResult = await this.uploadBuffer(Buffer.concat(input.chunks), {
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true,
      format: format || undefined,
      invalidate: true,
    })

    return {
      absolutePath: uploadResult.secure_url,
      relativePath: uploadResult.secure_url,
    }
  }

  async readRelativeFile(relativePath: string): Promise<Buffer> {
    const response = await fetch(relativePath)
    if (!response.ok) {
      throw new Error(`Failed to fetch cloud recording chunk: ${response.status}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  async deleteRelativeFile(relativePath: string): Promise<void> {
    const publicId = parseCloudinaryPublicIdFromUrl(relativePath)
    if (!publicId) {
      return
    }

    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'raw',
        invalidate: true,
      })
    } catch {
      // noop for MVP: stale cloud chunks are acceptable when replacement delete fails
    }
  }
}
