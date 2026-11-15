import { getShowcaseReels } from '@/server/showcase'
import { ShowcaseRow } from './ShowcaseRow'

/** Real feed reels playing as a landing-page row; renders nothing when none are available. */
export async function PhoneShowcase() {
  const reels = await getShowcaseReels()
  if (reels.length === 0) return null
  return <ShowcaseRow reels={reels} />
}
