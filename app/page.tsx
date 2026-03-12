import Link from 'next/link'

export default function HomePage() {
  return (
    <section className="mx-auto max-w-3xl">
      <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-glass">
        <p className="mb-2 text-sm uppercase tracking-wide text-brand-300">One room workflow</p>
        <h2 className="text-2xl font-semibold text-white">Create one room, then add guests</h2>
        <p className="mt-2 text-sm text-slate-300">
          Start as host, create a single room, and invite guests using the add guest link from the room screen.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/create"
            className="inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Create room
          </Link>
          <Link
            href="/join"
            className="inline-flex rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Join with invite
          </Link>
        </div>
      </article>
    </section>
  )
}
