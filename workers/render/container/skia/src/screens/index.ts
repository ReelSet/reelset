import type { ScreenName } from '../plan'
import { EndCard, ImageFull, KeyPoint, StatSlam, fallback } from './core'
import { CodeBlock, RepoDemo, RepoPage, Terminal } from './dev'
import { ArticleHeadline } from './editorial'
import { EquationScreen, FigureZoom, PaperPage, TableScreen } from './paper'
import { HNThread, RedditPost, YouTubePlayer } from './social'
import { BarRace, Compare } from './stats'
import type { Screen } from './types'

export { fallback }

/** Screens by planner name. Missing names draw `fallback`. */
export const SCREENS: Partial<Record<ScreenName, Screen>> = {
  KeyPoint,
  StatSlam,
  ImageFull,
  EndCard,
  RepoPage,
  Terminal,
  CodeBlock,
  RepoDemo,
  HNThread,
  RedditPost,
  YouTubePlayer,
  PaperPage,
  FigureZoom,
  TableScreen,
  EquationScreen,
  ArticleHeadline,
  BarRace,
  Compare,
}
