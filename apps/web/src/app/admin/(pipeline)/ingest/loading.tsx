import { AdminPageSkeleton } from '@/components/admin/Skeletons'

export default function Loading() {
  return <AdminPageSkeleton title={false} stats={4} rows={10} cols={7} />
}
