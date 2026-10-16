import type { MarkerSide, PaperSize } from '@binder/shared'

/** The mockup's thumbnail slot (`.dx-pv`): the page is drawn to fit inside it. */
const SLOT = { width: 196, height: 262 }
/** Paper sizes in points, portrait: only their proportions matter here. */
const PAPER_RATIO: Record<PaperSize, number> = { A4: 841.89 / 595.28, Letter: 792 / 612 }

/** The drawn page in pixels: the paper's own proportions, as large as the slot allows. */
export function previewSize(paper: PaperSize): { width: number; height: number } {
  const ratio = PAPER_RATIO[paper]
  const scale = Math.min(SLOT.width, SLOT.height / ratio)
  return { width: Math.round(scale), height: Math.round(scale * ratio) }
}

/** The tag slots down the page (`y` of the pill's top), and which department owns each: the mockup's. */
const SLOT_YS = [52, 62, 100, 120, 148, 166, 176]
const SLOT_RANKS = [0, 1, 1, 0, 2, 1, 0]
/** Where each department's one dashed standby / warn pill goes: clear of every solid slot. */
const STANDBY_YS = [80, 134, 192, 206, 220, 232]
const TAG = { width: 28, height: 9, inset: 6, leader: 14 }
const TEXT_LINES = 19

export interface PreviewDepartment {
  id: string
  code: string
  colour?: string | null
}

export interface PrintPreviewProps {
  paper: PaperSize
  /** The departments whose layers are printed, in the order the dialog lists them. */
  departments: readonly PreviewDepartment[]
  /** The margin a department's tags sit in (the show's setting). */
  sideOf: (departmentId: string) => MarkerSide
  /** Draws one dashed standby / warn pill per department. */
  standbyWarn: boolean
}

function list(codes: string[]): string {
  if (codes.length <= 1) return codes.join('')
  return `${codes.slice(0, -1).join(', ')} and ${codes.at(-1)}`
}

function describe(departments: readonly PreviewDepartment[], sideOf: PrintPreviewProps['sideOf']) {
  if (departments.length === 0) return 'Preview: no layers, a clean page'
  const left = departments.filter((d) => sideOf(d.id) === 'left').map((d) => d.code)
  const right = departments.filter((d) => sideOf(d.id) === 'right').map((d) => d.code)
  if (left.length === 0) return `Preview: ${list(right)} tags on the right`
  if (right.length === 0) return `Preview: ${list(left)} tags on the left`
  return `Preview: ${list(left)} tags on the left, ${list(right)} on the right`
}

/**
 * The print sheet's thumbnail (`.dx-pv`): a white page in the chosen paper's proportions with grey
 * text bars and a few sample tags in each printed department's margin, so the user sees which side
 * each prints on. It is a drawing, not a render of the script, and it needs no network.
 */
export function PrintPreview({ paper, departments, sideOf, standbyWarn }: PrintPreviewProps) {
  const { width, height } = previewSize(paper)
  const count = departments.length
  const tags: Array<{ dept: PreviewDepartment; y: number; kind: 'go' | 'standby' }> = []
  SLOT_YS.forEach((y, i) => {
    if (count === 0) return
    const rank = count <= 3 ? (SLOT_RANKS[i] as number) % count : i % count
    tags.push({ dept: departments[rank] as PreviewDepartment, y, kind: 'go' })
  })
  if (standbyWarn) {
    departments.forEach((dept, k) => {
      const y = STANDBY_YS[k]
      if (y !== undefined) tags.push({ dept, y, kind: 'standby' })
    })
  }
  return (
    <figure className="m-0 flex flex-col items-center gap-2.5">
      <svg
        role="img"
        aria-label={describe(departments, sideOf)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block shrink-0 rounded-[3px] shadow-[0_1px_0_rgba(0,0,0,0.6),0_8px_18px_rgba(0,0,0,0.4)]"
      >
        <rect width={width} height={height} rx={3} fill="var(--page)" />
        {Array.from({ length: TEXT_LINES }, (_, k) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing, never reordered
            key={k}
            x={46}
            y={34 + k * 11}
            width={width - 46 - (k % 5 === 4 ? 70 : 46)}
            height={2}
            fill="var(--page-ink)"
            opacity={0.17}
          />
        ))}
        {tags.map(({ dept, y, kind }) => {
          const side = sideOf(dept.id)
          const colour = dept.colour || 'var(--faint)'
          const x = side === 'left' ? TAG.inset : width - TAG.inset - TAG.width
          const from = side === 'left' ? TAG.inset + TAG.width : width - 48
          return (
            <g
              key={`${dept.id}-${kind}-${y}`}
              data-tag
              data-dept={dept.id}
              data-side={side}
              data-kind={kind}
            >
              <line
                x1={from}
                x2={from + TAG.leader}
                y1={y + TAG.height / 2}
                y2={y + TAG.height / 2}
                stroke={colour}
                strokeWidth={1}
              />
              <rect
                x={x}
                y={y}
                width={TAG.width}
                height={TAG.height}
                rx={TAG.height / 2}
                fill="var(--page)"
                stroke={colour}
                strokeWidth={1.2}
                strokeDasharray={kind === 'standby' ? '3 2' : undefined}
              />
            </g>
          )
        })}
      </svg>
      <figcaption className="text-center text-[12px] text-muted">
        Sides follow the show settings
      </figcaption>
    </figure>
  )
}
