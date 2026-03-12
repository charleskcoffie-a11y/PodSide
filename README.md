# Podside Studio MVP

Riverside-like full-stack MVP focused on one host + one guest.

## Folder structure

```text
app/
   create/
   join/
   room/[roomId]/
   recordings/
components/
   room/
   ui/
lib/
   hooks/
   upload/
server/
   src/
      db/
      routes/
      socket/
      storage/
      utils/
prisma/
   schema.prisma
```

## Tech stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind
- Backend: Express + Socket.IO
- Database: SQLite + Prisma
- Realtime: WebRTC (browser peer connection) + Socket signaling
- Recording: MediaRecorder, local stream only
- Storage: Local filesystem by default, optional Cloudinary storage driver (S3-ready later)

## Implemented MVP behavior

- Host creates room and guest joins with code.
- Host and guest get local/remote live WebRTC preview.
- Host controls start/stop recording.
- Each participant records local camera/mic stream (not mixed remote stream).
- Recorder emits chunk uploads on configurable interval (`NEXT_PUBLIC_CHUNK_INTERVAL_MS`, default `4000`).
- Chunk metadata includes room/session/participant/track/sequence/timestamp.
- Upload queue retries with exponential backoff and persists queue records in IndexedDB.
- Offline handling pauses uploads and resumes automatically when online.
- On stop, uploads flush, track finalizes, raw participant file is generated, and session manifest is written.
- Recordings dashboard includes session list/detail, chunks, playback, and download links.

## Environment

Copy `.env.example` to `.env`:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_CHUNK_INTERVAL_MS=4000

PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL="file:./dev.db"
RECORDINGS_DIR="server/recordings"
RECORDING_STORAGE_DRIVER=local

# Cloudinary (set driver to cloudinary to enable)
CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""
CLOUDINARY_UPLOAD_FOLDER="podside-recordings"
```

## Storage location

- Local mode (`RECORDING_STORAGE_DRIVER=local`, default): recordings are written under `server/recordings/{roomId}/{sessionId}/{participantId}/{trackType}`.
- Cloud mode (`RECORDING_STORAGE_DRIVER=cloudinary`): chunks, manifests, and final raw files are uploaded to Cloudinary as raw assets.

## Setup

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: `http://localhost:3000`
Backend: `http://localhost:4000`

## Scripts

- `npm run dev` — run Next.js + Express server concurrently
- `npm run build` — build frontend + backend
- `npm run start` — run production frontend + backend
- `npm run db:migrate` — Prisma migrations
- `npm run db:generate` — Prisma client generation
- `npm run db:seed` — seed demo room data
- `npm run db:studio` — Prisma Studio

## API surface (MVP)

- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/sessions/start`
- `POST /api/sessions/:sessionId/complete`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/uploads/chunk`
- `POST /api/uploads/finalize`
- `GET /recordings/*` static recording and manifest files (local mode)

## Notes

- This MVP intentionally avoids auth, timeline editing, live streaming, and AI features.
- Storage is adapter-friendly; local filesystem is default and Cloudinary is optional via env configuration.
- TODO markers are included in code for multi-track sync metadata, FFmpeg merged outputs, and resumable multipart cloud upload paths.
