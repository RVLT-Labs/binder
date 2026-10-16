/**
 * Why a document version failed to process, and the words the app uses for it.
 *
 * Only failures of an accepted upload are persisted as a `failure_code` on a failed version.
 * "Too large" (the 413 at upload) and "not a PDF" (the 400 magic-byte refusal) are never stored:
 * they are refused before any version row exists, so they have no code here.
 *
 * `error` on the version stays as the technical detail (the Details disclosure) and as the fallback
 * for a legacy row whose code is null.
 */

export const FAILURE_CODES = [
  'unreadable',
  'password_protected',
  'no_text',
  'low_resolution',
  'timeout',
  'cancelled',
  'enqueue_failed',
  'unknown',
] as const

export type FailureCode = (typeof FAILURE_CODES)[number]

export interface FailureParams {
  /** The median scan resolution; the copy for `low_resolution` quotes it. */
  dpi?: number | null
}

export interface FailureDescription {
  /** The short lower-case pill, for example "couldn’t read text". */
  title: string
  message: string
  /** True when running the same file again can succeed, so "Try again" can retry in place. */
  retryable: boolean
}

type Copy = { title: string; message: (params: FailureParams) => string; retryable: boolean }

const COPY: Record<FailureCode, Copy> = {
  unreadable: {
    title: 'couldn’t read file',
    message: () =>
      'This file isn’t a PDF Binder can open. It may be damaged. Export the script as a PDF again and upload that.',
    retryable: false,
  },
  password_protected: {
    title: 'password protected',
    message: () => 'This PDF needs a password to open. Remove the password and upload it again.',
    retryable: false,
  },
  no_text: {
    title: 'couldn’t read text',
    message: () =>
      'No text could be read from any page, so there is nothing to search or anchor cues to. Check it is the script, or upload a clearer scan.',
    retryable: false,
  },
  low_resolution: {
    title: 'couldn’t read text',
    message: ({ dpi }) =>
      typeof dpi === 'number' && Number.isFinite(dpi)
        ? `Scanned at ${Math.round(dpi)} dpi, so there is no text to search or anchor to. Try a 300 dpi scan.`
        : 'Scanned at a low resolution, so there is no text to search or anchor to. Try a 300 dpi scan.',
    retryable: false,
  },
  timeout: {
    title: 'couldn’t finish',
    message: () =>
      'This file took too long to process. Try again; if it keeps happening, split the PDF or upload a smaller scan.',
    retryable: true,
  },
  cancelled: {
    title: 'cancelled',
    message: () => 'Cancelled. The file is still here if you want to try again.',
    retryable: true,
  },
  enqueue_failed: {
    title: 'didn’t start',
    message: () => 'Binder couldn’t start processing this file. Try again.',
    retryable: true,
  },
  unknown: {
    title: 'couldn’t process',
    message: () =>
      'Binder couldn’t process this file. Try again; if it fails again, Details says why.',
    retryable: true,
  },
}

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value)
}

/** The pill, plain-language message and retry rule for a failure code. An unrecognised code reads as `unknown`. */
export function describeFailure(code: string, params: FailureParams = {}): FailureDescription {
  const copy = COPY[isFailureCode(code) ? code : 'unknown']
  return { title: copy.title, message: copy.message(params), retryable: copy.retryable }
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** Decimal file size for the status line: "340 KB", "1.4 MB", "12 MB" (one decimal under 10, none above). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let unit = 0
  let value = bytes
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  let text =
    value < 10 && unit > 0 ? String(Math.round(value * 10) / 10) : String(Math.round(value))
  // 999,999 B rounds to "1000 KB": step up a unit instead.
  if (Number(text) >= 1000 && unit < UNITS.length - 1) {
    unit += 1
    text = String(Math.round((value / 1000) * 10) / 10)
  }
  return `${text} ${UNITS[unit]}`
}
