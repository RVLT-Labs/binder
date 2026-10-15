/** One change-log row, reduced to what the activity feed sentence needs. */
export interface SummaryRow {
  table: string
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  /** The department the row belongs to (from its layer), or null when it has none. */
  departmentCode: string | null
}

type Verb =
  | 'placed'
  | 'added'
  | 'moved'
  | 'renumbered'
  | 'relabelled'
  | 'edited'
  | 'updated'
  | 'deleted'

const VERB_ORDER: readonly Verb[] = [
  'placed',
  'added',
  'moved',
  'renumbered',
  'relabelled',
  'edited',
  'updated',
  'deleted',
]

/** The columns an update touched: the keys of `after`, plus any only `before` names. */
function touched(row: SummaryRow): Set<string> {
  return new Set([...Object.keys(row.after ?? {}), ...Object.keys(row.before ?? {})])
}

/** The verbs one row contributes to; an update counts once per verb it triggers. */
function verbsOf(row: SummaryRow): Verb[] {
  if (row.table === 'cues') {
    if (row.op === 'insert') return [row.after?.anchor ? 'placed' : 'added']
    if (row.op === 'delete') return ['deleted']
    const keys = touched(row)
    const verbs: Verb[] = []
    if (keys.has('anchor')) verbs.push('moved')
    if (keys.has('major') || keys.has('minor')) verbs.push('renumbered')
    if (keys.has('label')) verbs.push('relabelled')
    for (const k of keys) {
      if (!['anchor', 'major', 'minor', 'label'].includes(k)) {
        verbs.push('edited')
        break
      }
    }
    return verbs
  }
  if (row.table === 'annotations') {
    if (row.op === 'insert') return ['added']
    if (row.op === 'delete') return ['deleted']
    const keys = touched(row)
    const verbs: Verb[] = []
    if (keys.has('anchor') || keys.has('geometry')) verbs.push('moved')
    for (const k of keys) {
      if (k !== 'anchor' && k !== 'geometry') {
        verbs.push('edited')
        break
      }
    }
    return verbs
  }
  return [row.op === 'insert' ? 'added' : row.op === 'delete' ? 'deleted' : 'updated']
}

/** `cue` and `annotation` read naturally; any other table is its name, singularised. */
function singular(table: string): string {
  if (table === 'cues') return 'cue'
  if (table === 'annotations') return 'annotation'
  return table.endsWith('ies') ? `${table.slice(0, -3)}y` : table.replace(/s$/, '')
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The activity feed sentence for one batch: "moved 3 TM cues and relabelled 1". A clause group is one
 * table and department; groups read in order of first appearance and are joined with "; ".
 */
export function summariseBatch(rows: SummaryRow[]): string {
  const groups = new Map<
    string,
    { table: string; code: string | null; counts: Map<Verb, number> }
  >()
  for (const row of rows) {
    const key = `${row.table}\u0000${row.departmentCode ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = { table: row.table, code: row.departmentCode, counts: new Map() }
      groups.set(key, group)
    }
    for (const verb of verbsOf(row)) group.counts.set(verb, (group.counts.get(verb) ?? 0) + 1)
  }
  const sentences: string[] = []
  for (const g of groups.values()) {
    const clauses: string[] = []
    for (const verb of VERB_ORDER) {
      const n = g.counts.get(verb)
      if (!n) continue
      if (clauses.length === 0) {
        const noun = n === 1 ? singular(g.table) : `${singular(g.table)}s`
        clauses.push(`${verb} ${n} ${g.code ? `${g.code} ` : ''}${noun}`)
      } else {
        clauses.push(`${verb} ${n}`)
      }
    }
    if (clauses.length > 0) sentences.push(joinClauses(clauses))
  }
  return sentences.join('; ')
}

/** Display names for the MCP client ids we know; any other agent shows as it calls itself. */
const KNOWN_AGENTS: ReadonlyMap<string, string> = new Map([
  ['claude-code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['claude-ai', 'Claude'],
])

/**
 * `'Jayden'`, or `'Jayden via Claude Code'` for an agent, taking its name up to the first `/` and
 * showing a known client id as its product name. The stored agent string is untouched.
 */
export function actorLabel(name: string, agent: string | null): string {
  if (!agent) return name
  const product = agent.split('/')[0].trim()
  if (!product) return name
  return `${name} via ${KNOWN_AGENTS.get(product.toLowerCase()) ?? product}`
}
