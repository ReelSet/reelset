import { AdminPageSkeleton } from '@/components/admin/Skeletons'

export default function Loading() {
  return <AdminPageSkeleton title={false} stats={8} rows={4} cols={4} />
}
