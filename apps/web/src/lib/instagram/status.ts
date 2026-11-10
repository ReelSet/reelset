export type PostBadge = { label: string; className: string }

const BADGES: Record<string, PostBadge> = {
  queued: { label: 'Queued', className: 'bg-info/20 text-info' },
  posting: { label: 'Posting', className: 'bg-info/20 text-info' },
  posted: { label: 'Posted', className: 'bg-ok/20 text-ok' },
  failed: { label: 'Failed', className: 'bg-danger/20 text-danger' },
  deleting: { label: 'Deleting', className: 'bg-warn/20 text-warn' },
  deleted: { label: 'Deleted', className: 'bg-raised text-faint' },
  draft: { label: 'Draft', className: 'bg-raised text-faint' },
}

const NOT_POSTED: PostBadge = { label: 'Not posted', className: 'bg-black/55 text-white/80' }

export function postBadge(status: string | null, deleteRequested = false): PostBadge {
  if (status === 'posted' && deleteRequested)
    return { label: 'Delete queued', className: BADGES.deleting!.className }
  if (!status) return NOT_POSTED
  return BADGES[status] ?? NOT_POSTED
}
