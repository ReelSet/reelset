'use client'

import { useState } from 'react'
import { BookmarkIcon, HeartIcon } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import type { PosterReel } from '@/server/profile'

type Tab = 'liked' | 'saved'

export function ProfileLibrary({ liked, saved }: { liked: PosterReel[]; saved: PosterReel[] }) {
  const [tab, setTab] = useState<Tab>('liked')
  const list = tab === 'liked' ? liked : saved

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {(
          [
            ['liked', 'Liked', liked.length, <HeartIcon key="h" className="h-4 w-4" />],
            ['saved', 'Saved', saved.length, <BookmarkIcon key="b" className="h-4 w-4" />],
          ] as const
        ).map(([key, label, count, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {icon}
            {label}
            <span className="text-xs tabular-nums text-faint">{count}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line py-10">
          <EmptyState
            icon={
              tab === 'liked' ? (
                <HeartIcon className="h-8 w-8" />
              ) : (
                <BookmarkIcon className="h-8 w-8" />
              )
            }
            title={tab === 'liked' ? 'No likes yet' : 'Nothing saved yet'}
            body={
              tab === 'liked'
                ? 'Double tap a reel to like it.'
                : 'Tap the bookmark on a reel to keep it here.'
            }
            action={
              <a
                href="/"
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
              >
                Browse reels
              </a>
            }
          />
        </div>
      ) : (
        <ul key={tab} className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-2">
          {list.map((r, i) => (
            <li
              key={r.id}
              className="animate-fade-up"
              style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
            >
              <a
                href={`/?reel=${r.id}`}
                className="group relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-surface transition active:scale-[0.97]"
              >
                {r.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.posterUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-8 text-[11px] leading-snug">
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">{r.title}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
