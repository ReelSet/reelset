import type { ComponentType } from 'react'
import type { ScreenName } from '../lib/types'
import { CodeBlock, RepoDemo, RepoPage, Terminal } from './dev'
import { ArticleHeadline, FigureZoom, ImageFull, PaperPage } from './editorial'
import { EquationScreen, TableScreen } from './paper'
import { HNThread, RedditPost, YouTubePlayer } from './social'
import { BarRace, Compare, StatSlam } from './stats'
import { EndCard, KeyPoint } from './text'
import type { ScreenProps } from './ui'

export const SCREENS: Record<ScreenName, ComponentType<ScreenProps>> = {
  RepoPage,
  Terminal,
  CodeBlock,
  StatSlam,
  BarRace,
  HNThread,
  RedditPost,
  YouTubePlayer,
  PaperPage,
  FigureZoom,
  TableScreen,
  EquationScreen,
  ArticleHeadline,
  ImageFull,
  KeyPoint,
  Compare,
  EndCard,
  RepoDemo,
}
