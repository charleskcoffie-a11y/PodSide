import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/lib/types'

const statusClassMap: Record<SessionStatus, string> = {
  connected: 'bg-slate-700/70 text-slate-100',
  recording: 'bg-rose-600/80 text-white',
  uploading: 'bg-amber-500/80 text-slate-900',
  completed: 'bg-emerald-500/80 text-slate-950',
  'upload-failed': 'bg-red-600/80 text-white',
}

export const StatusBadge = ({ status }: { status: SessionStatus }) => {
  const label =
    status === 'upload-failed'
      ? 'upload failed'
      : status === 'connected'
        ? 'connected'
        : status

  return (
    <span className={cn('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide', statusClassMap[status])}>
      {label}
    </span>
  )
}
