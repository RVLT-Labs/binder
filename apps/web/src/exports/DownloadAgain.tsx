import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { blobUrl, isBlobCached } from '../blobs/fetchBlob'
import { useOnline } from '../offline/useOnline'

/**
 * "Download again" for a stored export: a link that saves the file (the server shows it inline, so
 * `download` forces a save). Offline it works only if the file is already stored on this device;
 * otherwise it is disabled, and says why.
 */
export function DownloadAgain({ fileKey, filename }: { fileKey: string; filename: string }) {
  const online = useOnline()
  const url = blobUrl(fileKey)
  const [cached, setCached] = useState<{ url: string; cached: boolean } | null>(null)
  useEffect(() => {
    if (online) return
    let live = true
    void isBlobCached(url).then((has) => {
      if (live) setCached({ url, cached: has })
    })
    return () => {
      live = false
    }
  }, [online, url])

  const available = online || (cached?.url === url && cached.cached)
  if (available) {
    return (
      <Button asChild variant="line" size="sm" className={BG}>
        <a href={url} download={filename}>
          Download again
        </a>
      </Button>
    )
  }
  return (
    <span className="export-unavailable inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="line"
        size="sm"
        className={BG}
        disabled
        aria-describedby={`${fileKey}-why`}
      >
        Download again
      </Button>
      <span id={`${fileKey}-why`} className="text-[12px] text-muted">
        Available when online
      </span>
    </span>
  )
}

/**
 * "Download again" for an export still waiting to upload: the file is held on this device, so it
 * is saved from there and needs no network.
 */
export function DownloadLocal({
  bytes,
  contentType,
  filename,
}: {
  bytes: Uint8Array
  contentType: string
  filename: string
}) {
  // Made in the effect, so React's dev double-run (revoke, then run again) leaves a live URL.
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }))
    setUrl(made)
    return () => {
      URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [bytes, contentType])
  if (!url) return null
  return (
    <Button asChild variant="line" size="sm" className={BG}>
      <a href={url} download={filename}>
        Download again
      </a>
    </Button>
  )
}

/** The exports mockup draws its outlined buttons on the elevated fill (`.dx-ex .btn`). */
const BG = 'bg-elev'
