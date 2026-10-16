/** What every history view shows while the browser is offline. Personal undo is unaffected. */
export function NeedsConnection() {
  return (
    <p role="status" className="history-offline m-0 text-[13px] text-muted">
      History needs a connection.
    </p>
  )
}
