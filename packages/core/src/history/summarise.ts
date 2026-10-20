import { anchorChangeKind } from './anchorChange'

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
  | 'uploaded'
  | 'cancelled'
  | 'retried'
  | 'removed'
  | 'moved'
  | 'restyled'
  | 'renumbered'
  | 'relabelled'
  | 'edited'
  | 'updated'
  | 'deleted'

const VERB_ORDER: readonly Verb[] = [
  'placed',
  'added',
  'uploaded',
  'cancelled',
  'retried',
  'removed',
  'moved',
  'restyled',
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
    if (keys.has('anchor')) verbs.push(anchorChangeKind(row.before?.anchor, row.after?.anchor))
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
  if (row.table === 'documents' || row.table === 'document_versions') {
    if (row.op === 'insert') return ['uploaded']
    if (row.op === 'delete') return ['removed']
    if (row.table === 'document_versions') {
      // Processing controls (spec Feature 3): a cancel fails the version with code `cancelled`, a
      // retry takes a failed version back to queued.
      if (row.after?.failureCode === 'cancelled') return ['cancelled']
      if (row.before?.status === 'failed' && row.after?.status === 'queued') return ['retried']
    }
    return ['updated']
  }
  return [row.op === 'insert' ? 'added' : row.op === 'delete' ? 'deleted' : 'updated']
}

/** The verbs that act on a whole upload, which people call an "upload" whichever table it lives in. */
const UPLOAD_VERBS: ReadonlySet<Verb> = new Set(['cancelled', 'retried', 'removed'])

/**
 * `cue`, `annotation`, `document` and `revision` read naturally (a `document_versions` row is a
 * revision to a person, a `show_memberships` row a member); any other table is its name,
 * singularised, with its underscores as spaces so a column or table name never reads as code.
 */
function singular(table: string): string {
  if (table === 'cues') return 'cue'
  if (table === 'annotations') return 'annotation'
  if (table === 'documents') return 'document'
  if (table === 'document_versions') return 'revision'
  if (table === 'show_memberships') return 'member'
  const name = table.replace(/_/g, ' ')
  return name.endsWith('ies') ? `${name.slice(0, -3)}y` : name.replace(/s$/, '')
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

interface Group {
  table: string
  code: string | null
  counts: Map<Verb, number>
}

/**
 * The rows that count: a first version uploaded with its document is one upload, the document; and
 * the version deleted with its document (removing a document's only version) is one removal.
 */
function countable(rows: SummaryRow[]): SummaryRow[] {
  const documentInserted = rows.some((r) => r.table === 'documents' && r.op === 'insert')
  const documentDeleted = rows.some((r) => r.table === 'documents' && r.op === 'delete')
  if (!documentInserted && !documentDeleted) return rows
  return rows.filter((r) => {
    if (r.table !== 'document_versions') return true
    if (documentInserted && r.op === 'insert' && r.after?.versionNumber === 1) return false
    return !(documentDeleted && r.op === 'delete')
  })
}

/** One group per table and department, in order of first appearance, with its verb counts. */
function groupRows(rows: SummaryRow[]): Group[] {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = `${row.table}\u0000${row.departmentCode ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = { table: row.table, code: row.departmentCode, counts: new Map() }
      groups.set(key, group)
    }
    for (const verb of verbsOf(row)) group.counts.set(verb, (group.counts.get(verb) ?? 0) + 1)
  }
  return [...groups.values()]
}

/**
 * One group's clauses: "moved 3 TM cues and relabelled 1" (the feed) or, with `codeFirst`, "TM moved
 * 3 cues and relabelled 1" (the show card).
 */
function renderGroup(g: Group, codeFirst: boolean): string {
  const clauses: string[] = []
  for (const verb of VERB_ORDER) {
    const n = g.counts.get(verb)
    if (!n) continue
    if (clauses.length === 0) {
      const base = UPLOAD_VERBS.has(verb) ? 'upload' : singular(g.table)
      const noun = n === 1 ? base : `${base}s`
      const code = g.code ? `${g.code} ` : ''
      clauses.push(codeFirst ? `${code}${verb} ${n} ${noun}` : `${verb} ${n} ${code}${noun}`)
    } else {
      clauses.push(`${verb} ${n}`)
    }
  }
  return joinClauses(clauses)
}

/**
 * The activity feed sentence for one batch: "moved 3 TM cues and relabelled 1". A clause group is one
 * table and department; groups read in order of first appearance and are joined with "; ".
 */
export function summariseBatch(rows: SummaryRow[]): string {
  return groupRows(countable(rows))
    .map((g) => renderGroup(g, false))
    .filter((s) => s !== '')
    .join('; ')
}

/** `n` of a noun with a past participle: "revision uploaded", "2 revisions uploaded". */
function uploaded(n: number, noun: string): string {
  return n === 1 ? `${noun} uploaded` : `${n} ${noun}s uploaded`
}

/**
 * The show card's one-line sentence for a batch. One table and department of cues or annotations
 * leads with the department: "LX relabelled 3 cues". A batch of only revision (or only document)
 * inserts reads "revision uploaded" ("2 revisions uploaded"). Anything else is the feed sentence,
 * for example "moved 12 LX cues; added 2 SND annotations".
 */
export function cardSentence(rows: SummaryRow[]): string {
  const counted = countable(rows)
  const groups = groupRows(counted)
  if (groups.length === 1) {
    const [g] = groups
    if (g.table === 'cues' || g.table === 'annotations') return renderGroup(g, true)
    if (g.table === 'documents' || g.table === 'document_versions') {
      if (counted.every((r) => r.op === 'insert')) {
        return uploaded(counted.length, singular(g.table))
      }
      // Only cancels, only retries or only removals: "upload cancelled", "2 uploads removed".
      const verbs = [...g.counts.keys()]
      if (verbs.length === 1 && UPLOAD_VERBS.has(verbs[0])) {
        const n = g.counts.get(verbs[0]) ?? 0
        return `${n === 1 ? 'upload' : `${n} uploads`} ${verbs[0]}`
      }
    }
  }
  return summariseBatch(rows)
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
