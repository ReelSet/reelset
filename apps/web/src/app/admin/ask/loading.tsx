import { AdminPageSkeleton } from '@/components/admin/Skeletons'

export default function Loading() {
  return <AdminPageSkeleton stats={3} rows={10} cols={6} />
}
