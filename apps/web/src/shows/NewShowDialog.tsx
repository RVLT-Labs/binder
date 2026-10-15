import { usePowerSync } from '@powersync/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { api } from '@/api/client'
import { pushNotice } from '@/components/noticeStore'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogShell } from '@/components/ui/dialog-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { closeModal, openModal, restoreFocus } from '@/lib/modalDialog'

/** How long to wait for a new show to sync down before going to it anyway. */
const SYNC_WAIT_MS = 5_000

export interface NewShowDialogProps {
  /** The control that opened the dialog: focus goes back to it however the dialog closes. */
  returnFocusTo: HTMLElement | null
  /** The dialog has closed (cancelled, dismissed or done). The caller stops rendering it. */
  onClose: () => void
}

/**
 * "New show": a name, then Create. It is a modal opened by the caller mounting it and closed by
 * Cancel, Escape or a created show, which it then goes to. Only the name step exists so far.
 */
export function NewShowDialog({ returnFocusTo, onClose }: NewShowDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const fieldId = useId()
  const navigate = useNavigate()
  const db = usePowerSync()
  const [title, setTitle] = useState('')

  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api.get<{ organisations: { id: string; name: string }[] }>('/me/orgs'),
  })

  const create = useMutation({
    mutationFn: async (name: string) => {
      const org = orgs.data?.organisations[0]
      if (!org) throw new Error('You have no organisation to create a show in')
      const { show } = await api.post<{ show: { id: string } }>(`/orgs/${org.id}/shows`, {
        title: name,
      })
      // The show reaches this device through sync like every other row; going to it before it has
      // arrived would show "Show not found".
      await arrived(show.id)
      return show.id
    },
    onSuccess: (showId) => {
      // Cancelled or dismissed while it was being made: the show exists, but stay where they are.
      if (!ref.current?.open) return
      closeModal(ref.current, returnFocusTo)
      void navigate({ to: '/shows/$showId', params: { showId } })
    },
    onError: (err) =>
      pushNotice({ kind: 'error', message: `Could not create the show: ${err.message}` }),
  })

  async function arrived(showId: string) {
    const deadline = Date.now() + SYNC_WAIT_MS
    while (Date.now() < deadline) {
      if (await db.getOptional('SELECT id FROM shows WHERE id = ?', [showId])) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }

  useEffect(() => {
    if (ref.current) openModal(ref.current)
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    const name = title.trim()
    if (name && !create.isPending) create.mutate(name)
  }

  return (
    <DialogShell
      ref={ref}
      labelledBy={titleId}
      // Escape and Cancel both end in the dialog's `close` event.
      onClose={() => {
        restoreFocus(returnFocusTo)
        onClose()
      }}
    >
      <form onSubmit={submit}>
        <DialogHeader id={titleId}>New show</DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>New show title</Label>
          <Input
            id={fieldId}
            value={title}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-[12px] text-muted">You can rename it any time.</p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="line"
            onClick={() => closeModal(ref.current, returnFocusTo)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim() || !orgs.data}>
            Create
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  )
}
