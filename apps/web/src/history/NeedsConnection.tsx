/** What every history view shows while the browser is offline. Personal undo is unaffected. */
export function NeedsConnection() {
  return (
    <p role="status" className="muted history-offline">
      History needs a connection.
    </p>
  )
}
