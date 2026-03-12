import cors from 'cors'
import express from 'express'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { appConfig } from './config.js'
import roomsRouter from './routes/rooms.js'
import { createSessionsRouter } from './routes/sessions.js'
import { createUploadsRouter } from './routes/uploads.js'
import { installSignalingHandlers } from './socket/signaling.js'
import { CloudinaryStorageAdapter } from './storage/cloudinary-storage-adapter.js'
import { LocalRecordingStorageAdapter } from './storage/local-storage-adapter.js'
import type { RecordingStorageAdapter } from './storage/storage-adapter.js'

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: appConfig.frontendOrigin,
    methods: ['GET', 'POST'],
  },
})

const storageAdapter: RecordingStorageAdapter =
  appConfig.storageDriver === 'cloudinary'
    ? (() => {
        if (!appConfig.cloudinary.cloudName || !appConfig.cloudinary.apiKey || !appConfig.cloudinary.apiSecret) {
          throw new Error(
            'Cloudinary storage driver selected but CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET is missing.',
          )
        }

        return new CloudinaryStorageAdapter({
          cloudName: appConfig.cloudinary.cloudName,
          apiKey: appConfig.cloudinary.apiKey,
          apiSecret: appConfig.cloudinary.apiSecret,
          uploadFolder: appConfig.cloudinary.uploadFolder,
        })
      })()
    : (() => {
        mkdirSync(appConfig.recordingsDir, { recursive: true })
        return new LocalRecordingStorageAdapter(appConfig.recordingsDir)
      })()

app.use(
  cors({
    origin: appConfig.frontendOrigin,
  }),
)
app.use(express.json({ limit: '3mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'podside-server', storageDriver: appConfig.storageDriver })
})

if (appConfig.storageDriver === 'local') {
  app.use('/recordings', express.static(appConfig.recordingsDir))

  app.get('/api/recordings/file', (req, res) => {
    const rawRelativePath = String(req.query.path ?? '')
    const sanitizedPath = rawRelativePath.replace(/\.\./g, '')

    if (!sanitizedPath) {
      res.status(400).json({ ok: false, error: 'Missing file path.' })
      return
    }

    const absolutePath = path.resolve(appConfig.recordingsDir, sanitizedPath)
    if (!absolutePath.startsWith(path.resolve(appConfig.recordingsDir))) {
      res.status(400).json({ ok: false, error: 'Invalid file path.' })
      return
    }

    res.download(absolutePath)
  })
}

app.use('/api', roomsRouter)
app.use('/api', createSessionsRouter(storageAdapter))
app.use('/api', createUploadsRouter(storageAdapter))

installSignalingHandlers(io)

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  res.status(500).json({ ok: false, error: 'Unexpected server error.' })
})

httpServer.listen(appConfig.port, () => {
  console.log(`Podside server listening on http://localhost:${appConfig.port} using ${appConfig.storageDriver} storage`)
})
