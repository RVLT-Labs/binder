import { copyFile } from 'node:fs/promises'
import type { OcrMode } from '@binder/shared'
import { firstLine, runTool, ToolError } from './exec'

const OCRMYPDF_TIMEOUT_MS = 30 * 60 * 1000

export interface OcrResult {
  ocrApplied: boolean
  /** OCRmyPDF's exit code; null when it was not run, could not start, or was killed. */
  exitCode: number | null
  stderr: string
}

/**
 * Writes the searchable PDF to `output`. Mode `auto` runs OCRmyPDF with `--redo-ocr`, which keeps
 * existing vector text and OCRs only image regions (spec 5.1). Mode `never`, and any OCRmyPDF
 * failure (2 invalid input, 6 already has text, 7 child process error, 8 encrypted, 15 other, or a
 * failure to start), writes a plain copy of the input instead.
 */
export async function runOcrmypdf(
  input: string,
  output: string,
  opts: { mode: OcrMode },
): Promise<OcrResult> {
  if (opts.mode === 'never') {
    await copyFile(input, output)
    return { ocrApplied: false, exitCode: null, stderr: '' }
  }
  try {
    const { stderr } = await runTool(
      'ocrmypdf',
      [
        '--redo-ocr',
        '--output-type',
        'pdf',
        '--optimize',
        '0',
        '-l',
        'eng',
        '--jobs',
        '2',
        input,
        output,
      ],
      { timeoutMs: OCRMYPDF_TIMEOUT_MS },
    )
    return { ocrApplied: true, exitCode: 0, stderr }
  } catch (err) {
    if (!(err instanceof ToolError)) throw err
    await copyFile(input, output)
    return { ocrApplied: false, exitCode: err.exitCode, stderr: err.stderr }
  }
}

/** The one-line summary stored in the version's `error` when OCR fell back to a copy. */
export function describeOcrFailure(result: OcrResult): string {
  return `ocrmypdf exit ${result.exitCode ?? 'none'}: ${firstLine(result.stderr)}`
}
