export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'payload_too_large'

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  payload_too_large: 413,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
  }
}

export const unauthenticated = () => new AppError('unauthenticated', 'Authentication required')
export const forbidden = (msg = 'Forbidden') => new AppError('forbidden', msg)
export const notFound = (msg = 'Not found') => new AppError('not_found', msg)
export const invalid = (msg: string) => new AppError('invalid', msg)
export const conflict = (msg: string) => new AppError('conflict', msg)
export const payloadTooLarge = (msg = 'Payload too large') => new AppError('payload_too_large', msg)
