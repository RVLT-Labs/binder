import { type HTMLAttributes, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Escape in a choice or field leaves it and keeps the row selected; only an Escape outside the form
 * deselects. Put on the editor's section: text fields cancel their draft first and mark the event handled.
 */
export function leaveFieldOnEscape(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const field = e.target
  if (
    field instanceof HTMLSelectElement ||
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    e.preventDefault()
    field.blur()
  }
}

export interface CommitInputProps {
  id: string
  value: string
  onCommit: (value: string) => void
  /** Escape threw the draft away and restored the stored value. */
  onCancel?: () => void
  multiline?: boolean
  disabled?: boolean
  className?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  placeholder?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/**
 * A text field that edits a draft and commits it on blur or Enter; Escape throws the draft away and
 * leaves the field. It follows `value` while not focused.
 */
export function CommitInput({
  value,
  onCommit,
  onCancel,
  multiline = false,
  ...aria
}: CommitInputProps) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  /** Set by Escape so the blur that follows does not commit the abandoned draft. */
  const cancelled = useRef(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  const common = {
    ...aria,
    // the tablet sheet's fields are 40 px / 14 px (t-markup `.mb-tsheet .field .in`)
    className: cn(
      multiline
        ? 'md:max-[1024px]:min-h-[60px] md:max-[1024px]:text-[14px]'
        : 'md:max-[1024px]:h-10 md:max-[1024px]:text-[14px]',
      aria.className,
    ),
    value: draft,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      if (cancelled.current) cancelled.current = false
      else onCommit(multiline ? draft : draft.trim())
    },
  }
  function cancelOnEscape(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key !== 'Escape') return false
    e.preventDefault()
    cancelled.current = true
    setDraft(value)
    onCancel?.()
    e.currentTarget.blur()
    return true
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (cancelOnEscape(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit(draft.trim())
    }
  }
  return multiline ? (
    <Textarea
      {...common}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={cancelOnEscape}
    />
  ) : (
    <Input {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} />
  )
}
