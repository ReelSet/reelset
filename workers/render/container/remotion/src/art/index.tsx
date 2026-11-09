import type { ArtKind } from '../lib/art'
import { Bars } from './Bars'
import { GitGraph } from './GitGraph'
import type { ArtProps } from './kit'
import { Network } from './Network'
import { Paper } from './Paper'
import { Terminal } from './Terminal'
import { Thread } from './Thread'
import { Timeline } from './Timeline'

export type { ArtProps }

const SCENES: Record<ArtKind, (props: ArtProps) => React.ReactElement> = {
  network: Network,
  terminal: Terminal,
  gitgraph: GitGraph,
  bars: Bars,
  paper: Paper,
  timeline: Timeline,
  thread: Thread,
}

export function Art({ kind, ...props }: ArtProps & { kind: ArtKind }) {
  const Scene = SCENES[kind]
  return <Scene {...props} />
}
