/** A pressure stroke made of joined nib impressions, without moving the sampled centreline.
 * Preview, saved SVG and PDF export use this same path. Repeated dot samples are canonicalised.
 */
export function inkPath(geometry: Record<string, number>, size: number, flipY = false): string {
  const parts: string[] = []
  let previous: { x: number; y: number; r: number } | null = null
  const at = (x: number, y: number) => `${x} ${flipY ? -y : y}`
  for (let i = 0; i < Math.min(geometry.count ?? 0, 4096); i++) {
    const x = geometry[`x${i}`],
      y = geometry[`y${i}`],
      p = geometry[`p${i}`]
    if (![x, y, p].every(Number.isFinite)) continue
    const r = size * (0.2 + 0.6 * Math.min(1, Math.max(0, p)))
    if (previous !== null && previous.x === x && previous.y === y && previous.r === r) continue
    // All subpaths share their winding, so overlapping nibs form one opaque fill.
    const sweep = flipY ? 1 : 0
    parts.push(
      `M ${at(x + r, y)} A ${r} ${r} 0 1 ${sweep} ${at(x - r, y)} A ${r} ${r} 0 1 ${sweep} ${at(x + r, y)} Z`,
    )
    if (previous) {
      const dx = x - previous.x,
        dy = y - previous.y,
        length = Math.hypot(dx, dy)
      if (length > 0) {
        const nx = -dy / length,
          ny = dx / length
        parts.push(
          `M ${at(previous.x + nx * previous.r, previous.y + ny * previous.r)} L ${at(x + nx * r, y + ny * r)} L ${at(x - nx * r, y - ny * r)} L ${at(previous.x - nx * previous.r, previous.y - ny * previous.r)} Z`,
        )
      }
    }
    previous = { x, y, r }
  }
  return parts.join(' ')
}
