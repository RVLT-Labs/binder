import { execFile } from 'node:child_process'

/** A command-line tool that exited non-zero, timed out, or could not be started. */
export class ToolError extends Error {
  constructor(
    message: string,
    /** The exit code, or null when the tool was killed or never started. */
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
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

/**
 * Runs a tool without a shell, arguments as an array, killing it after `timeoutMs`. Resolves with
 * its output on exit 0; otherwise rejects with a ToolError carrying the exit code and stderr.
 */
export function runTool(
  command: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr })
        const exitCode = typeof err.code === 'number' ? err.code : null
        const reason = err.killed
          ? `timed out after ${opts.timeoutMs / 1000}s`
          : exitCode !== null
            ? `exited ${exitCode}`
            : `failed to start (${err.code ?? err.message})`
        const detail = stderr.trim() || err.message
        reject(new ToolError(`${command} ${reason}: ${detail}`, exitCode, stderr || err.message))
      },
    )
  })
}
