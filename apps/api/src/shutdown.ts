export interface ShutdownSteps {
  /** Stop accepting connections. */
  closeServer: () => void
  /** Stop the job queue, letting in-flight jobs finish. */
  stopQueue: () => Promise<unknown>
  /** Close the database pool. */
  endPool: () => Promise<unknown>
  exit: (code: number) => void
  log?: (message: string, err?: unknown) => void
}

/**
 * Builds the signal handler. A failing step is logged and the next one still runs, and the process
 * always exits (non-zero if anything failed), so a stuck queue cannot leave the container hanging
 * until the orchestrator kills it. A second signal while stopping is ignored.
 */
export function createShutdown(steps: ShutdownSteps): (signal: string) => Promise<void> {
  const log =
    steps.log ??
    ((message, err) => (err === undefined ? console.log(message) : console.error(message, err)))
  let stopping = false
  return async (signal) => {
    if (stopping) return
    stopping = true
    log(`${signal} received, shutting down`)
    let failed = false
    const attempt = async (name: string, step: () => unknown) => {
      try {
        await step()
      } catch (err) {
        failed = true
        log(`shutdown: ${name} failed`, err)
      }
    }
    await attempt('close server', steps.closeServer)
    await attempt('stop job queue', steps.stopQueue)
    await attempt('end database pool', steps.endPool)
    steps.exit(failed ? 1 : 0)
  }
}
