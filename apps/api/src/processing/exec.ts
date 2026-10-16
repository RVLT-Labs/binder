import { spawn } from 'node:child_process'

/** How long a tool gets to exit after SIGTERM before its whole process group is sent SIGKILL. */
export const KILL_GRACE_MS = 5000

/** More output than this (stdout and stderr together) fails the run, as execFile's maxBuffer did. */
const MAX_BUFFER_BYTES = 256 * 1024 * 1024

/** A command-line tool that exited non-zero, timed out, was aborted, or could not be started. */
export class ToolError extends Error {
  constructor(
    message: string,
    /** The exit code, or null when the tool was killed or never started. */
    readonly exitCode: number | null,
    readonly stderr: string,
    flags: { aborted?: boolean; timedOut?: boolean } = {},
  ) {
    super(message)
    this.name = 'ToolError'
    this.aborted = flags.aborted ?? false
    this.timedOut = flags.timedOut ?? false
  }

  /** The caller's AbortSignal stopped the tool (a cancel); never a failure worth retrying or copying past. */
  readonly aborted: boolean
  /** The tool ran past its timeout and was killed. */
  readonly timedOut: boolean
}

/** The first non-empty line of a tool's output, for one-line error summaries. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  )
}

/** Signals a whole process group (the tool and every child it started); a group already gone is fine. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH: nobody left in the group.
  }
}

/**
 * Runs a tool without a shell, arguments as an array, killing it after `timeoutMs` or when `signal`
 * aborts. The tool leads its own process group, and a kill is aimed at the group (SIGTERM, then
 * SIGKILL after KILL_GRACE_MS), so the helpers it started (ghostscript, tesseract) die with it
 * instead of running on as orphans. Resolves with its output on exit 0; otherwise rejects with a
 * ToolError carrying the exit code and stderr, `timedOut` after a timeout, `aborted` after an abort.
 */
export function runTool(
  command: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  const { signal } = opts
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(
        new ToolError(`${command} aborted before it started`, null, '', { aborted: true }),
      )
    }
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const pid = child.pid
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let killReason: 'timeout' | 'abort' | 'buffer' | null = null
    let escalate: NodeJS.Timeout | undefined
    let settled = false

    const kill = (reason: 'timeout' | 'abort' | 'buffer') => {
      if (killReason || pid === undefined) return
      killReason = reason
      killGroup(pid, 'SIGTERM')
      // Left running after the tool exits, so a helper that outlives it is still swept up.
      escalate = setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS)
      escalate.unref()
    }
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs)
    const onAbort = () => kill('abort')
    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (!killReason) clearTimeout(escalate)
      fn()
    }
    const collect = (which: 'out' | 'err') => (chunk: string) => {
      bytes += chunk.length
      if (which === 'out') stdout += chunk
      else stderr += chunk
      if (bytes > MAX_BUFFER_BYTES) kill('buffer')
    }
    child.stdout.setEncoding('utf8').on('data', collect('out'))
    child.stderr.setEncoding('utf8').on('data', collect('err'))

    child.on('error', (err: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          new ToolError(
            `${command} failed to start (${err.code ?? err.message}): ${err.message}`,
            null,
            err.message,
          ),
        ),
      ),
    )
    const onEnd = (code: number | null, sig: NodeJS.Signals | null) =>
      finish(() => {
        if (!killReason && code === 0) return resolve({ stdout, stderr })
        const detail = stderr.trim()
        // What a caller sees as the tool's stderr: its own, or our description when it said nothing.
        const text = (message: string) => stderr || message
        if (killReason === 'abort') {
          return reject(
            new ToolError(`${command} aborted: ${detail || 'killed'}`, null, text('killed'), {
              aborted: true,
            }),
          )
        }
        if (killReason === 'timeout') {
          return reject(
            new ToolError(
              `${command} timed out after ${opts.timeoutMs / 1000}s: ${detail || 'killed'}`,
              null,
              text(`timed out after ${opts.timeoutMs / 1000}s`),
              { timedOut: true },
            ),
          )
        }
        if (killReason === 'buffer') {
          return reject(
            new ToolError(`${command} produced too much output`, null, text('too much output')),
          )
        }
        const reason = code !== null ? `exited ${code}` : `was terminated by ${sig ?? 'a signal'}`
        reject(new ToolError(`${command} ${reason}: ${detail || reason}`, code, text(reason)))
      })
    // After a kill, settle as soon as the tool itself is gone: a helper that kept the output pipes
    // open must not hold the caller up (the SIGKILL timer still sweeps the group).
    child.on('exit', (code, sig) => {
      if (killReason) onEnd(code, sig)
    })
    child.on('close', onEnd)
  })
}
