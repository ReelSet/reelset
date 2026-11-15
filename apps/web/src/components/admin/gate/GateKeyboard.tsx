'use client'

import { useEffect, useState } from 'react'
import { button } from '@/components/admin/primitives'

const ROW = 'tr[data-gate-row]'
const SCOPE = '[data-gate-table]'
const TYPING = 'input, textarea, select, [contenteditable="true"]'

const SHORTCUTS = [
  { keys: 'J / K', does: 'Move to the next or previous decision' },
  { keys: 'A', does: 'Agree with the focused decision' },
  { keys: 'D', does: 'Open the disagree picker' },
  { keys: 'Enter', does: 'Open the item drawer' },
  { keys: '?', does: 'Show or hide this list' },
] as const

// Module scope, so the target survives the re-render (or remount) that follows a server action.
let focusAfterAction: string | null = null

const allRows = () => [...document.querySelectorAll<HTMLTableRowElement>(ROW)]
const focusedRow = () => document.activeElement?.closest<HTMLTableRowElement>(ROW) ?? null
const isUnreviewed = (row: HTMLTableRowElement) => row.dataset.reviewed === 'false'

function focusRow(row: HTMLTableRowElement | undefined | null) {
  if (!row) return
  row.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'nearest' })
}

function move(from: HTMLTableRowElement | null, step: 1 | -1) {
  const rows = allRows()
  const index = from ? rows.indexOf(from) + step : 0
  focusRow(rows[Math.min(Math.max(index, 0), rows.length - 1)])
}

function nextUnreviewed(after: HTMLTableRowElement): HTMLTableRowElement | null {
  const rows = allRows()
  const index = rows.indexOf(after)
  const later = rows.slice(index + 1).find(isUnreviewed)
  return later ?? rows.slice(0, index).reverse().find(isUnreviewed) ?? null
}

function openDisagree(row: HTMLTableRowElement) {
  const picker = row.querySelector<HTMLDetailsElement>('details[data-gate-disagree]')
  if (!picker) return
  picker.open = true
  picker.querySelector<HTMLSelectElement>('select')?.focus()
}

const ROW_KEYS: Record<string, (row: HTMLTableRowElement) => void> = {
  a: (row) => row.querySelector<HTMLFormElement>('form[data-gate-agree]')?.requestSubmit(),
  d: openDisagree,
  Enter: (row) => row.querySelector<HTMLAnchorElement>('[data-gate-title] a')?.click(),
}

function inScope(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(TYPING)) return false
  return target === document.body || target.closest(SCOPE) !== null
}

function handleRowKey(event: KeyboardEvent): boolean {
  const row = focusedRow()
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === 'j' || key === 'k') {
    move(row, key === 'j' ? 1 : -1)
    return true
  }
  const action = row ? ROW_KEYS[key] : undefined
  if (!row || !action) return false
  // Enter on a button or link inside the row keeps its normal meaning.
  if (event.key === 'Enter' && document.activeElement !== row) return false
  action(row)
  return true
}

function rememberNextRow(event: SubmitEvent) {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-gate-form]')) return
  const row = form.closest<HTMLTableRowElement>(ROW)
  if (row) focusAfterAction = nextUnreviewed(row)?.dataset.decision ?? null
}

function restoreFocus() {
  if (!focusAfterAction) return
  const row = document.querySelector<HTMLTableRowElement>(
    `${ROW}[data-decision="${focusAfterAction}"]`,
  )
  focusAfterAction = null
  focusRow(row)
}

/** Keyboard review for the gate table: the keys trigger the same forms the buttons submit. `rowsKey` changes when the rows do. */
export function GateKeyboard({ rowsKey }: { rowsKey: string }) {
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || !inScope(event.target)) return
      if (event.key === 'Escape') return setSheetOpen(false)
      if (event.key === '?') setSheetOpen((open) => !open)
      else if (!handleRowKey(event)) return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('submit', rememberNextRow, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('submit', rememberNextRow, true)
    }
  }, [])

  useEffect(restoreFocus, [rowsKey])

  return (
    <div className="relative">
      <button
        type="button"
        className={button}
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen((open) => !open)}
      >
        Shortcuts
        <kbd className="ml-1 rounded border border-line px-1 font-mono text-[10px] text-faint">
          ?
        </kbd>
      </button>
      {sheetOpen ? (
        <dl
          aria-label="Keyboard shortcuts"
          className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-md border border-line-strong bg-raised p-3 text-xs shadow-lg"
        >
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-fg">{shortcut.keys}</dt>
              <dd className="text-right text-muted">{shortcut.does}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
