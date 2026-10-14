/** Pixel width and height from a JPEG's first start-of-frame marker. */
export function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
  const buf = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  let i = 2
  while (i + 9 <= buf.length) {
    const marker = buf.readUInt16BE(i)
    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  throw new Error('no JPEG frame header')
}
