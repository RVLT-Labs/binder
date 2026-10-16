import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCanUpload } from '../revisions/useCanUpload'
import { UploadDialog, type UploadTarget } from './UploadDialog'

interface OpenOptions {
  /** The control that opened it, so focus goes back there. */
  opener?: HTMLElement | null
  /** A file already chosen, e.g. one dropped on the Documents screen. */
  file?: File | null
}

interface UploadApi {
  canUpload: boolean
  openUpload: (target: UploadTarget, options?: OpenOptions) => void
}

const UploadContext = createContext<UploadApi | null>(null)

/** The show's one upload dialog, opened from the top bar, a document row or a drop on the Documents screen. */
export function UploadProvider({ showId, children }: { showId: string; children: ReactNode }) {
  const canUpload = useCanUpload(showId)
  const [open, setOpen] = useState<({ target: UploadTarget } & OpenOptions) | null>(null)
  const openUpload = useCallback<UploadApi['openUpload']>(
    (target, options = {}) => setOpen({ target, ...options }),
    [],
  )
  const api = useMemo(() => ({ canUpload, openUpload }), [canUpload, openUpload])
  return (
    <UploadContext.Provider value={api}>
      {children}
      {open && canUpload && (
        <UploadDialog
          // A new target is a new form.
          key={`${open.target.kind}:${'documentId' in open.target ? open.target.documentId : ''}`}
          showId={showId}
          target={open.target}
          returnFocusTo={open.opener ?? null}
          initialFile={open.file ?? null}
          onClose={() => setOpen(null)}
        />
      )}
    </UploadContext.Provider>
  )
}

export function useUpload(): UploadApi {
  const api = useContext(UploadContext)
  if (!api) throw new Error('useUpload needs an UploadProvider')
  return api
}

/** The top bar's one red action on the show's page and its Documents screen. Absent for viewers. */
export function UploadDocumentButton() {
  const { canUpload, openUpload } = useUpload()
  if (!canUpload) return null
  return (
    <Button
      type="button"
      className="max-md:mx-2"
      // The phone's top bar has room for one short word; the name stays the full one.
      aria-label="Upload document"
      onClick={(e) => openUpload({ kind: 'document' }, { opener: e.currentTarget })}
    >
      <span aria-hidden className="md:hidden">
        Upload
      </span>
      <span aria-hidden className="max-md:hidden">
        Upload document
      </span>
    </Button>
  )
}
