'use client'

/** Toggles every checkbox that belongs to the given form id. */
export function SelectAllCheckbox({ formId, name = 'itemId' }: { formId: string; name?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(event) => {
        const boxes = document.querySelectorAll<HTMLInputElement>(
          `input[type="checkbox"][name="${name}"][form="${formId}"]`,
        )
        for (const box of boxes) box.checked = event.currentTarget.checked
      }}
    />
  )
}
