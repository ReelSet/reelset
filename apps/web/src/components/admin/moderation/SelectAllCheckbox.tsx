'use client'

/** Toggles every checkbox that belongs to the given form id. */
export function SelectAllCheckbox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(event) => {
        const boxes = document.querySelectorAll<HTMLInputElement>(
          `input[type="checkbox"][name="itemId"][form="${formId}"]`,
        )
        for (const box of boxes) box.checked = event.currentTarget.checked
      }}
    />
  )
}
