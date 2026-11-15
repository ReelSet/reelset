import { AdminPageSkeleton } from '@/components/admin/Skeletons'

export default function Loading() {
  return <AdminPageSkeleton title={false} filters rows={12} cols={6} />
}
