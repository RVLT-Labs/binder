/** RVLT red: Binder's alert colour. Never a department colour. */
export const RVLT_RED = '#E0363D'

/** The seven default department colours (DESIGN 4.3), tuned to read as ink on white paper. */
export const DEPARTMENT_COLOUR_PRESETS: readonly { code: string; colour: string }[] = [
  { code: 'LX', colour: '#C9811F' },
  { code: 'SND', colour: '#2F6BD6' },
  { code: 'TM', colour: '#7A5CD0' },
  { code: 'SM', colour: '#1C8B83' },
  { code: 'VID', colour: '#C2487E' },
  { code: 'STG', colour: '#CC5E2E' },
  { code: 'FLY', colour: '#6E8C12' },
]

/** Chrome tints for the defaults, for use on dark chrome. */
const CHROME_TINTS: Readonly<Record<string, string>> = {
  '#C9811F': '#EBA53A',
  '#2F6BD6': '#5B8DEF',
  '#7A5CD0': '#9B82E6',
  '#1C8B83': '#3FC8BE',
  '#C2487E': '#E875AC',
  '#CC5E2E': '#EF7E55',
  '#6E8C12': '#AFC44E',
}

/** A department colour as it should appear on dark chrome. */
export function deptChrome(hex: string): string {
  const tint = CHROME_TINTS[hex.toUpperCase()]
  return tint ?? `color-mix(in oklab, ${hex} 70%, white)`
}

type Lab = readonly [number, number, number]

function hexToLab(hex: string): Lab {
  const lin = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(0), lin(1), lin(2)] as const
  // sRGB -> XYZ (D65), normalised to the D65 white point.
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)] as const
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 colour difference. */
function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

const RED_LAB = hexToLab(RVLT_RED)
const RED_THRESHOLD = 20

/** True when a colour is within CIE ΔE76 20 of RVLT red. Expects a #RRGGBB string. */
export function isTooCloseToRed(hex: string): boolean {
  return deltaE76(hexToLab(hex), RED_LAB) < RED_THRESHOLD
}

/** WCAG sRGB contrast of a department mark against Binder's fixed white script page. */
export function departmentMarkContrast(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels.reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  return 1.05 / (luminance + 0.05)
}

/** Validate new or deliberately changed colours; callers preserve unchanged legacy values. */
export function departmentColourProblem(hex: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'Use a colour like #2F6BD6.'
  if (isTooCloseToRed(hex)) return "Red is kept for Binder's own alerts. Pick another colour."
  if (departmentMarkContrast(hex) < 3)
    return 'Pick a mark with at least 3:1 contrast against the white page.'
  return null
}
