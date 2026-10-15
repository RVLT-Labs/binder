import { useEffect, useState } from 'react'
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
      <a href={url} download={filename}>
        Download again
      </a>
    )
  }
  return (
    <span className="export-unavailable">
      <button type="button" disabled aria-describedby={`${fileKey}-why`}>
        Download again
      </button>{' '}
      <span id={`${fileKey}-why`} className="muted">
        Available when online
      </span>
    </span>
  )
}
