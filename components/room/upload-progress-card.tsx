import type { UploadProgress } from '@/lib/types'

export const UploadProgressCard = ({
  title,
  progress,
}: {
  title: string
  progress: UploadProgress | null
}) => {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm text-slate-200">
      <p className="font-semibold">{title}</p>
      {!progress ? (
        <p className="mt-1 text-slate-400">No upload metrics yet.</p>
      ) : (
        <div className="mt-2 space-y-1 text-slate-300">
          <p>Uploaded: {progress.uploadedChunks}</p>
          <p>Pending: {progress.pendingChunks}</p>
          <p>Failed attempts: {progress.failedChunks}</p>
          <p>Retrying: {progress.retrying ? 'Yes' : 'No'}</p>
        </div>
      )}
    </div>
  )
}
