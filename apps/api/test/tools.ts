import { execFileSync } from 'node:child_process'

/** The commands (with a cheap version flag) that are not runnable here. */
export function findMissingTools(
  tools: ReadonlyArray<readonly [string, readonly string[]]>,
): string[] {
  return tools
    .filter(([cmd, args]) => {
      try {
        execFileSync(cmd, args, { stdio: 'ignore' })
        return false
      } catch {
        return true
      }
    })
    .map(([cmd]) => cmd)
}

/**
 * Whether a suite that needs external PDF tools should be skipped. Locally a missing tool skips it
 * with a warning; in CI (process.env.CI set) it throws, so the run fails instead of going green
 * without exercising processing.
 */
export function skipWithoutTools(suite: string, missing: string[]): boolean {
  if (missing.length === 0) return false
  const tools = missing.join(', ')
  if (process.env.CI) {
    throw new Error(`${suite}: missing tools in CI: ${tools}. CI must install them, not skip.`)
  }
  console.warn(`Skipping ${suite}; missing tools: ${tools}`)
  return true
}
