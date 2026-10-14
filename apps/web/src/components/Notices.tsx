import { dismissNotice, useNotices } from './noticeStore'

/** Rejected sync writes and other problems the user should know about. */
export function Notices() {
  const notices = useNotices()
  if (notices.length === 0) return null
  return (
    <ul className="notices" aria-label="Notices">
      {notices.map((n) => (
        <li key={n.id} role="alert" className={`notice notice-${n.kind}`}>
          <span>{n.message}</span>
          {n.action && (
            <button type="button" onClick={n.action.run}>
              {n.action.label}
            </button>
          )}
          <button type="button" onClick={() => dismissNotice(n.id)} aria-label="Dismiss notice">
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
