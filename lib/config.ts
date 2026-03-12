const parseNumber = (raw: string | undefined, fallback: number) => {
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export const appConfig = {
  serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000',
  chunkIntervalMs: parseNumber(process.env.NEXT_PUBLIC_CHUNK_INTERVAL_MS, 4000),
}
