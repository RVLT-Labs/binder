/** The 27 printable CP1252 characters outside Latin-1 that WinAnsiEncoding also carries. */
const CP1252_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/**
 * Text safe to draw in a standard PDF font (WinAnsiEncoding), which throws on anything else.
 * Per code point: printable ASCII, U+00A0 to U+00FF and the CP1252 extras pass; a line break
 * becomes a space (a CR LF pair is one break); everything else becomes `?`.
 */
export function toWinAnsi(s: string): string {
  let out = ''
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string
    const cp = ch.codePointAt(0) as number
    if (ch === '\r' && chars[i + 1] === '\n') continue
    if (ch === '\n' || ch === '\r' || cp === 0x2028 || cp === 0x2029) out += ' '
    else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRAS.has(ch))
      out += ch
    else out += '?'
  }
  return out
}
