import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Podside Studio',
  description: 'Riverside-like local recording MVP for host and guest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 rounded-2xl border border-white/10 bg-slate-900/70 px-5 py-4 shadow-glass backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white">Podside Studio</h1>
                <p className="text-sm text-slate-400">Host + guest WebRTC recording with resilient chunk uploads</p>
              </div>

              <nav className="flex items-center gap-4 text-sm font-medium">
                <Link href="/">Home</Link>
                <Link href="/join">Join Room</Link>
                <Link href="/recordings">Recordings</Link>
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  )
}
