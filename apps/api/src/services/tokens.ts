import { createHash, randomBytes } from 'node:crypto'
import { type Db, personalAccessTokens, showMemberships } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { invalid, notFound } from '../errors'

type Row = typeof personalAccessTokens.$inferSelect
/** A token row without its hash: the only shape that leaves the service layer. */
export type PersonalAccessToken = Omit<Row, 'tokenHash'>
export type ShowScope = '*' | string[]

export const TOKEN_PREFIX = 'bnd_'
const LAST_USED_GRANULARITY_MS = 60_000

const hashToken = (plain: string) => createHash('sha256').update(plain).digest('hex')

function toRecord({ tokenHash: _hash, ...rest }: Row): PersonalAccessToken {
  return rest
}

export async function createToken(
  db: Db,
  actor: Actor,
  input: { name: string; showScope: ShowScope; expiresAt?: Date },
): Promise<{ token: string; record: PersonalAccessToken }> {
  const { showScope } = input
  if (showScope !== '*') {
    if (showScope.length === 0) throw invalid('showScope must be "*" or a non-empty list of shows')
    const ids = [...new Set(showScope)]
    const rows = await db
      .select({ showId: showMemberships.showId })
      .from(showMemberships)
      .where(and(eq(showMemberships.userId, actor.userId), inArray(showMemberships.showId, ids)))
    if (rows.length !== ids.length)
      throw invalid('showScope includes a show you are not a member of')
  }
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const [row] = await db
    .insert(personalAccessTokens)
    .values({
      id: newId(),
      userId: actor.userId,
      name: input.name,
      tokenHash: hashToken(token),
      showScope,
      expiresAt: input.expiresAt ?? null,
    })
    .returning()
  return { token, record: toRecord(row) }
}

export async function listTokens(db: Db, actor: Actor): Promise<PersonalAccessToken[]> {
  const rows = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, actor.userId))
    .orderBy(desc(personalAccessTokens.createdAt))
  return rows.map(toRecord)
}

/** Revoking an already revoked token keeps its original revocation time. */
export async function revokeToken(
  db: Db,
  actor: Actor,
  input: { tokenId: string },
): Promise<PersonalAccessToken> {
  const [row] = await db
    .select()
    .from(personalAccessTokens)
    .where(
      and(
        eq(personalAccessTokens.id, input.tokenId),
        eq(personalAccessTokens.userId, actor.userId),
      ),
    )
  if (!row) throw notFound('Token not found')
  if (row.revokedAt) return toRecord(row)
  const [updated] = await db
    .update(personalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(personalAccessTokens.id, row.id))
    .returning()
  return toRecord(updated)
}

/** Null for unknown, revoked, or expired tokens. Touches last_used_at at most once a minute. */
export async function authenticateToken(
  db: Db,
  plain: string,
): Promise<{
  userId: string
  tokenId: string
  showScope: ShowScope
  expiresAt: Date | null
} | null> {
  if (!plain.startsWith(TOKEN_PREFIX)) return null
  const [row] = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tokenHash, hashToken(plain)))
  const now = new Date()
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) return null
  const stale = new Date(now.getTime() - LAST_USED_GRANULARITY_MS)
  await db
    .update(personalAccessTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(personalAccessTokens.id, row.id),
        or(isNull(personalAccessTokens.lastUsedAt), lt(personalAccessTokens.lastUsedAt, stale)),
      ),
    )
  return { userId: row.userId, tokenId: row.id, showScope: row.showScope, expiresAt: row.expiresAt }
}

export function tokenAllowsShow(scope: ShowScope, showId: string): boolean {
  return scope === '*' || scope.includes(showId)
}
