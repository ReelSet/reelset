import { TopicsIndex, topicsMetadata } from './topics-index'

// `?source=` variants are rewritten by proxy.ts to /t/by/<source>, so this page stays one entry.
export const revalidate = 300

export const metadata = topicsMetadata(null)

export default function TopicsPage() {
  return <TopicsIndex source={null} />
}
