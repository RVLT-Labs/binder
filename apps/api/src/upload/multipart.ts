import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import busboy from 'busboy'
import type { Context } from 'hono'
import { AppError, invalid, payloadTooLarge } from '../errors'

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

const MAX_FIELD_BYTES = 64 * 1024

export interface Upload {
  /** Text fields that arrived before the file part. Clients must send the file last. */
  fields: Record<string, string>
  /** The file bytes, beginning with the expected magic when one was asked for. Errors with `payload_too_large` or `invalid` if the upload fails mid-stream. */
  file: { stream: Readable; filename: string }
}

export interface UploadOptions {
  /**
   * The bytes the file must begin with (`%PDF-` for a PDF, `PK` for a zip such as an XLSX); none to
   * take any file. A function gets the text fields that arrived before the file part and answers
   * for this upload (an export's `kind` is in its `meta` field); if it throws, the upload fails with that error.
   */
  magic?: string | ((fields: Record<string, string>) => string | undefined)
}

/** What a failed magic check calls the file the caller wanted. */
const MAGIC_NAMES: Record<string, string> = { '%PDF-': 'a PDF', PK: 'an XLSX workbook' }

/** Counts every request byte and fails the stream past `max`, whatever Content-Length claimed. */
export function byteLimit(max: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      seen += chunk.length
      if (seen > max) cb(payloadTooLarge(`Upload exceeds ${Math.round(max / (1024 * 1024))} MB`))
      else cb(null, chunk)
    },
  })
}

/**
 * Passes bytes through after checking that the stream starts with `magic`. `onValid` fires once,
 * on the first chunk that settles the question, so callers see a rejection before any byte is stored.
 */
export function magicCheck(magic: string, onValid: () => void, onClose: () => void): Transform {
  const expected = Buffer.from(magic, 'latin1')
  const wrong = () => invalid(`File is not ${MAGIC_NAMES[magic] ?? 'the expected type'}`)
  let head = Buffer.alloc(0)
  let checked = false
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (checked) return cb(null, chunk)
      head = Buffer.concat([head, chunk])
      if (head.length < expected.length) return cb()
      if (!head.subarray(0, expected.length).equals(expected)) return cb(wrong())
      checked = true
      onValid()
      cb(null, head)
    },
    flush(cb) {
      cb(checked ? null : wrong())
    },
    destroy(err, cb) {
      onClose()
      cb(err)
    },
  })
}

/** `magicCheck` for a PDF (`%PDF-`): what a fetched PDF and every PDF upload pass through. */
export const pdfMagicCheck = (onValid: () => void, onClose: () => void): Transform =>
  magicCheck('%PDF-', onValid, onClose)

/** A pass-through for uploads with no expected type: settles on the first byte (or the end of an empty file). */
function anyFile(onValid: () => void, onClose: () => void): Transform {
  let started = false
  const start = () => {
    if (started) return
    started = true
    onValid()
  }
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      start()
      cb(null, chunk)
    },
    flush(cb) {
      start()
      cb()
    },
    destroy(err, cb) {
      onClose()
      cb(err)
    },
  })
}

/**
 * Parse a multipart request, resolving as soon as the file part has begun and (when `opts.magic` is
 * given) its first bytes are confirmed to start with it. The rest of the file keeps streaming;
 * nothing is buffered beyond stream back-pressure. Rejects `payload_too_large` on an oversize
 * Content-Length (before reading) or when the bytes actually received pass `maxBytes`, and `invalid`
 * for malformed, aborted or wrong-type uploads.
 */
export function readUpload(
  c: Context,
  maxBytes: number,
  opts: UploadOptions = {},
): Promise<Upload> {
  const declared = Number(c.req.header('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(
      payloadTooLarge(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`),
    )
  }
  const contentType = c.req.header('content-type') ?? ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return Promise.reject(invalid('Expected a multipart/form-data body'))
  }
  const body = c.req.raw.body
  if (!body) return Promise.reject(invalid('Request body is empty'))

  return new Promise<Upload>((resolve, reject) => {
    let parser: busboy.Busboy
    try {
      parser = busboy({
        headers: { 'content-type': contentType },
        limits: { files: 1, fields: 10, parts: 12, fieldSize: MAX_FIELD_BYTES },
      })
    } catch {
      return reject(invalid('Malformed multipart body'))
    }

    const source = Readable.fromWeb(body as import('node:stream/web').ReadableStream)
    const fields: Record<string, string> = {}
    let settled = false
    let fileStream: Transform | null = null

    const fail = (err: unknown) => {
      const appError =
        err instanceof AppError ? err : invalid('Upload was interrupted or malformed')
      if (!settled) {
        settled = true
        reject(appError)
      }
      // Once the caller holds the file stream, it carries the failure.
      fileStream?.destroy(appError)
      source.destroy()
    }

    parser.on('field', (name, value) => {
      fields[name] = value
    })
    parser.on('fieldsLimit', () => fail(invalid('Too many fields')))
    parser.on('partsLimit', () => fail(invalid('Too many parts')))
    parser.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume()
        return
      }
      const onValid = () => {
        if (settled) return
        settled = true
        resolve({ fields, file: { stream: check, filename: info.filename || 'upload' } })
      }
      // Closing the stream early (consumer gave up) must not leave the request half-read.
      const onClose = () => {
        if (!check.writableFinished) source.destroy()
      }
      stream.on('error', fail)
      let magic: string | undefined
      try {
        magic = typeof opts.magic === 'function' ? opts.magic(fields) : opts.magic
      } catch (err) {
        stream.resume()
        return fail(err)
      }
      const check =
        magic === undefined ? anyFile(onValid, onClose) : magicCheck(magic, onValid, onClose)
      fileStream = check
      stream.pipe(check)
      check.on('error', fail)
    })
    parser.on('close', () => {
      if (!settled) fail(invalid('A file part named "file" is required'))
    })

    pipeline(source, byteLimit(maxBytes), parser).catch(fail)
  })
}
