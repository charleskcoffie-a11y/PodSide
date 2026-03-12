import path from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: path.resolve(process.cwd(), '.env') })
loadEnv({ path: path.resolve(process.cwd(), 'server/.env') })

const parseNumber = (raw: string | undefined, fallback: number) => {
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : fallback
}

const parseStorageDriver = (raw: string | undefined) => {
  if (raw?.toLowerCase() === 'cloudinary') {
    return 'cloudinary' as const
  }

  return 'local' as const
}

export const appConfig = {
  port: parseNumber(process.env.PORT, 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  storageDriver: parseStorageDriver(process.env.RECORDING_STORAGE_DRIVER),
  recordingsDir: path.resolve(process.cwd(), process.env.RECORDINGS_DIR ?? 'server/recordings'),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    uploadFolder: process.env.CLOUDINARY_UPLOAD_FOLDER ?? 'podside-recordings',
  },
}
