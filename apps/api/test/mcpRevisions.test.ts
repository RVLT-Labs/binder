import { cues } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createShow, createToken, listOrganisations } from '../src/services'
import { callTool, connectMcp, resultText } from './mcpHelpers'
import { missingTools } from './processingHelpers'
import { buildRevisedFixture, type RevisedFixture } from './revisionsHelpers'
import { skipWithoutTools } from './tools'

const skip = skipWithoutTools('MCP revisions tests', missingTools)

let F: RevisedFixture
let owner: Client
let viewer: Client
let scoped: Client
const clients: Client[] = []

async function connect(userId: string, showScope: '*' | string[] = '*') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(F.s.deps.db, actor, { name: 't', showScope })
  const c = await connectMcp(F.s.app, token)
  clients.push(c)
  return c
}

beforeAll(async () => {
  if (skip) return
  F = await buildRevisedFixture()
  owner = await connect(F.s.owner.id)
  viewer = await connect(F.s.viewer.id)
  const [org] = await listOrganisations(F.s.deps.db, F.s.actors.owner)
  const elsewhere = await createShow(F.s.deps.db, F.s.actors.owner, {
    organisationId: org.id,
    title: 'Elsewhere',
  })
  scoped = await connect(F.s.owner.id, [elsewhere.id])
}, 900_000)

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

const anchorOf = async (id: string) =>
  (await F.s.deps.db.select().from(cues).where(eq(cues.id, id)))[0]?.anchor

describe.skipIf(skip)('the revisions tools', () => {
  test('are listed, three read-only and resolve_reanchor_item a write', async () => {
    const { tools } = await owner.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    for (const name of ['get_reanchor_review', 'get_version_anchors', 'compare_versions']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true)
    }
    expect(byName.get('resolve_reanchor_item')?.annotations?.readOnlyHint).toBe(false)
  })

  test('get_reanchor_review, resolve_reanchor_item, get_version_anchors, and compare_versions answer through MCP', async () => {
    // review: what the run could not place, with the anchor it had
    const review = await callTool(owner, 'get_reanchor_review', { documentId: F.docId })
    expect(review.isError).toBeFalsy()
    const body = review.structuredContent as unknown as {
      currentVersionId: string
      pending: Array<{
        rowId: string
        title: string
        previous: { documentVersionId: string } | null
      }>
      olderVersions: unknown[]
    }
    expect(body.currentVersionId).toBe(F.v2)
    const item = body.pending.find((i) => i.rowId === F.rows.cueAccept.id)
    expect(item?.title).toBe('LX 12 · Accept me')
    expect(item?.previous?.documentVersionId).toBe(F.v1)
    expect(resultText(review)).not.toContain(F.rows.viewerNote.id)

    // resolve: accept as the owner, written through the cue service as an MCP actor
    const accepted = await callTool(owner, 'resolve_reanchor_item', {
      table: 'cues',
      rowId: F.rows.cueAccept.id,
      action: 'accept',
    })
    expect(accepted.isError).toBeFalsy()
    expect((accepted.structuredContent as { anchor: { status: string } }).anchor.status).toBe('ok')
    expect(await anchorOf(F.rows.cueAccept.id)).toMatchObject({ status: 'ok' })

    // revert goes back to v1; the refusal for a viewer writes nothing
    const reverted = await callTool(owner, 'resolve_reanchor_item', {
      table: 'cues',
      rowId: F.rows.cueRevert.id,
      action: 'revert',
    })
    expect(
      (reverted.structuredContent as { anchor: { documentVersionId: string } }).anchor
        .documentVersionId,
    ).toBe(F.v1)
    const refused = await callTool(viewer, 'resolve_reanchor_item', {
      table: 'cues',
      rowId: F.rows.cueSnd.id,
      action: 'accept',
    })
    expect(refused.isError).toBe(true)
    expect(resultText(refused)).toMatch(/^forbidden:/)
    expect(await anchorOf(F.rows.cueSnd.id)).toMatchObject({ status: 'unresolved' })

    // a personal note of someone else does not exist for the caller
    const hidden = await callTool(owner, 'resolve_reanchor_item', {
      table: 'annotations',
      rowId: F.rows.viewerNote.id,
      action: 'accept',
    })
    expect(hidden.isError).toBe(true)
    expect(resultText(hidden)).toMatch(/^not_found:/)

    // version anchors: v1 as it was, the viewer sees their own note and not the owner's
    const v1 = await callTool(owner, 'get_version_anchors', { versionId: F.v1 })
    const rows = (v1.structuredContent as { anchors: Array<{ rowId: string }> }).anchors
    expect(rows.map((r) => r.rowId)).toContain(F.rows.deptNote.id)
    expect(rows.map((r) => r.rowId)).not.toContain(F.rows.viewerNote.id)
    const mine = await callTool(viewer, 'get_version_anchors', { versionId: F.v1 })
    const mineIds = (mine.structuredContent as { anchors: Array<{ rowId: string }> }).anchors.map(
      (r) => r.rowId,
    )
    expect(mineIds).toContain(F.rows.viewerNote.id)
    expect(mineIds).not.toContain(F.rows.ownerNote.id)

    // compare: the cut lines are removed; limit caps the entries
    const diff = await callTool(viewer, 'compare_versions', {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 10,
    })
    expect(diff.isError).toBeFalsy()
    const d = diff.structuredContent as unknown as {
      entries: Array<{ op: string }>
      removed: number
      truncated: boolean
    }
    // limit counts changed entries: ten of them, each with the default two lines of context
    expect(d.entries.filter((e) => e.op !== 'same')).toHaveLength(10)
    expect(d.entries.length).toBeGreaterThan(10)
    expect(d.truncated).toBe(true)
    expect(d.removed).toBeGreaterThan(0)
    const tooBig = await callTool(owner, 'compare_versions', {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 10001,
    })
    expect(tooBig.isError).toBe(true)
    const bare = await callTool(owner, 'compare_versions', {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 10,
      context: 0,
    })
    expect((bare.structuredContent as unknown as { entries: unknown[] }).entries).toHaveLength(10)
    const tooMuchContext = await callTool(owner, 'compare_versions', {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      context: 21,
    })
    expect(tooMuchContext.isError).toBe(true)
  })

  test('a token scoped to another show is forbidden on all four tools', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['get_reanchor_review', { documentId: F.docId }],
      ['get_version_anchors', { versionId: F.v1 }],
      ['compare_versions', { fromVersionId: F.v1, toVersionId: F.v2 }],
      ['resolve_reanchor_item', { table: 'cues', rowId: F.rows.cueKept.id, action: 'accept' }],
    ]
    for (const [name, args] of calls) {
      const r = await callTool(scoped, name, args)
      expect(r.isError, name).toBe(true)
      expect(resultText(r), name).toMatch(/^forbidden:/)
    }
  })
})
