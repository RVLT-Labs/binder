import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import { AppError, invalid, payloadTooLarge } from '../errors'
import { byteLimit, MAX_UPLOAD_BYTES, pdfMagicCheck } from './multipart'

export const FETCH_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5

/**
 * Addresses a server-side fetch must never reach: private, loopback, link-local (including the
 * 169.254.169.254 metadata service), carrier-grade NAT, multicast, reserved and documentation
 * ranges. IPv4-mapped IPv6 addresses are checked against the IPv4 rules by BlockList itself.
 */
const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 127], // unspecified and loopback
  ['64:ff9b::', 96], // NAT64, which embeds an IPv4 address
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which embeds an IPv4 address
  ['fc00::', 7], // unique local, including fd00:ec2::254 (metadata)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6')
}

/** True for a literal IP address that is safe to fetch from. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

const blockedAddress = () => invalid('URL resolves to a private or reserved address')

export interface FetchPdfOptions {
  maxBytes?: number
  timeoutMs?: number
  /** Which resolved addresses may be connected to. Tests widen it to reach a local server. */
  allowAddress?: (address: string) => boolean
}

function parseHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalid('Not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('Only http and https URLs can be fetched')
  }
  if (url.username || url.password) throw invalid('URLs with credentials are not accepted')
  return url
}

/**
 * A DNS lookup that refuses every answer set containing a disallowed address. It runs at connect
 * time, so the address that is checked is the address that is used (no DNS rebinding window).
 */
function guardedLookup(allow: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      const cb = callback as (
        e: NodeJS.ErrnoException | null,
        a: string | LookupAddress[],
        f?: number,
      ) => void
      if (err) return cb(err, '')
      if (addresses.length === 0 || addresses.some((a) => !allow(a.address))) {
        return cb(blockedAddress() as unknown as NodeJS.ErrnoException, '')
      }
      if (options.all) return cb(null, addresses)
      const [first] = addresses
      cb(null, first.address, first.family)
    })
  }
}

function describeFailure(err: unknown, timeoutMs: number, signal: AbortSignal): AppError {
  if (err instanceof AppError) return err
  const e = err as NodeJS.ErrnoException
  if (signal.aborted) {
    return invalid(`Download timed out after ${Math.round(timeoutMs / 1000)} s`)
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN')
    return invalid('Could not resolve the URL host')
  return invalid(`Download failed${e?.code ? ` (${e.code})` : ''}`)
}

function get(
  url: URL,
  allow: (address: string) => boolean,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    // Literal IP hosts never reach the lookup function, so check them here.
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
    if (isIP(host) !== 0 && !allow(host)) return reject(blockedAddress())
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(allow),
        signal,
        headers: { accept: 'application/pdf, */*;q=0.5', 'user-agent': 'binder' },
      },
      resolve,
    )
    req.on('error', reject)
    req.end()
  })
}

/**
 * Download a PDF from a public http(s) URL as a stream for `createDocument`/`addDocumentVersion`.
 * Resolves once the first bytes prove it is a PDF. Refuses other schemes and any host that resolves
 * to a private or reserved address (also after redirects), enforces `maxBytes` (200 MB) while
 * streaming, and aborts the whole transfer after `timeoutMs` (60 s). Failures are AppErrors, also
 * when they surface later on the returned stream.
 */
export async function fetchPdf(rawUrl: string, opts: FetchPdfOptions = {}): Promise<Readable> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const allow = opts.allowAddress ?? isPublicAddress
  const signal = AbortSignal.timeout(timeoutMs)

  let url = parseHttpUrl(rawUrl)
  let res: IncomingMessage
  for (let hops = 0; ; hops++) {
    try {
      res = await get(url, allow, signal)
    } catch (err) {
      throw describeFailure(err, timeoutMs, signal)
    }
    const location = res.headers.location
    const status = res.statusCode ?? 0
    if (status < 300 || status >= 400 || !location) break
    res.resume()
    if (hops >= MAX_REDIRECTS) throw invalid('Too many redirects')
    url = parseHttpUrl(new URL(location, url).href)
  }

  if (res.statusCode !== 200) {
    res.resume()
    throw invalid(`Download failed with HTTP ${res.statusCode}`)
  }
  const declared = Number(res.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy()
    throw payloadTooLarge(`Download exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`)
  }

  const body = res
  return new Promise<Readable>((resolve, reject) => {
    let settled = false
    const check = pdfMagicCheck(
      () => {
        settled = true
        resolve(check)
      },
      () => {
        if (!check.writableFinished) body.destroy()
      },
    )
    const fail = (err: unknown) => {
      const appError = describeFailure(err, timeoutMs, signal)
      if (!settled) {
        settled = true
        reject(appError)
      }
      if (!check.destroyed) check.destroy(appError)
      body.destroy()
    }
    const limit = byteLimit(maxBytes)
    body.on('error', fail)
    limit.on('error', fail)
    check.on('error', fail)
    body.pipe(limit).pipe(check)
  })
}
