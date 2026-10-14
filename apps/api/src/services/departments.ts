import { departments, shows } from '@binder/db'
import { type Actor, layerKey, type NumberFormat, newId } from '@binder/shared'
import { and, asc, eq, type InferSelectModel, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, notFound } from '../errors'
import { departmentFields, normaliseCode, parseOrInvalid } from '../validation'
import { logChange } from './changeLog'
import type { Executor } from './executor'
import { assertShowWritable, requireShowRole } from './tenancy'

export type Department = InferSelectModel<typeof departments>

const codeField = departmentFields.code.transform(normaliseCode)
const createSchema = z.object({
  code: codeField,
  name: departmentFields.name,
  colour: departmentFields.colour,
  numberFormat: departmentFields.numberFormat.optional(),
  sortOrder: departmentFields.sortOrder.optional(),
})
const patchSchema = z
  .object({
    code: codeField,
    name: departmentFields.name,
    colour: departmentFields.colour,
    numberFormat: departmentFields.numberFormat,
    sortOrder: departmentFields.sortOrder,
    hidden: departmentFields.hidden,
  })
  .partial()

const LOGGED = ['code', 'name', 'colour', 'numberFormat', 'sortOrder', 'hidden'] as const

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

const duplicateCode = (code: string) => conflict(`A department with code ${code} already exists`)

/** Any member. Hidden departments are included (they keep their cues); callers filter for pickers. */
export async function listDepartments(
  db: Executor,
  actor: Actor,
  input: { showId: string },
): Promise<Department[]> {
  await requireShowRole(db, actor, input.showId, 'viewer')
  return db
    .select()
    .from(departments)
    .where(eq(departments.showId, input.showId))
    .orderBy(asc(departments.sortOrder), asc(departments.code))
}

export async function createDepartment(
  db: Executor,
  actor: Actor,
  input: {
    showId: string
    code: string
    name: string
    colour: string
    numberFormat?: NumberFormat
    sortOrder?: number
    batchId?: string
  },
): Promise<Department> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    await requireShowRole(tx, actor, input.showId, 'owner')
    const [show] = await tx.select().from(shows).where(eq(shows.id, input.showId))
    if (!show) throw notFound('Show not found')
    assertShowWritable(show)
    const fields = parseOrInvalid(createSchema, input)

    const [dup] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.showId, input.showId), eq(departments.code, fields.code)))
    if (dup) throw duplicateCode(fields.code)

    let sortOrder = fields.sortOrder
    if (sortOrder === undefined) {
      const [{ max }] = await tx
        .select({ max: sql<number | null>`max(${departments.sortOrder})` })
        .from(departments)
        .where(eq(departments.showId, input.showId))
      sortOrder = max === null ? 0 : max + 10
    }

    let created: Department
    try {
      ;[created] = await tx
        .insert(departments)
        .values({
          id: newId(),
          showId: input.showId,
          code: fields.code,
          name: fields.name,
          colour: fields.colour,
          numberFormat: fields.numberFormat ?? 'decimal',
          sortOrder,
          updatedBy: actor.userId,
        })
        .returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateCode(fields.code)
      throw err
    }
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'departments',
      rowId: created.id,
      op: 'insert',
      before: null,
      after: Object.fromEntries(LOGGED.map((k) => [k, created[k]])),
      layer: layerKey({ kind: 'department', id: created.id }),
    })
    return created
  })
}

export async function updateDepartment(
  db: Executor,
  actor: Actor,
  input: {
    departmentId: string
    patch: {
      code?: string
      name?: string
      colour?: string
      numberFormat?: NumberFormat
      sortOrder?: number
      hidden?: boolean
    }
    batchId?: string
    clientTs?: Date
  },
): Promise<Department> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(departments)
      .where(eq(departments.id, input.departmentId))
    if (!current) throw notFound('Department not found')
    await requireShowRole(tx, actor, current.showId, 'owner')
    const [show] = await tx.select().from(shows).where(eq(shows.id, current.showId))
    if (!show) throw notFound('Show not found')
    assertShowWritable(show)
    const patch = parseOrInvalid(patchSchema, input.patch)

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of LOGGED) {
      const next = patch[key]
      if (next === undefined || next === current[key]) continue
      before[key] = current[key]
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    if (typeof after.code === 'string') {
      const [dup] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            eq(departments.showId, current.showId),
            eq(departments.code, after.code),
            ne(departments.id, current.id),
          ),
        )
      if (dup) throw duplicateCode(after.code)
    }

    let updated: Department
    try {
      ;[updated] = await tx
        .update(departments)
        .set({ ...after, updatedBy: actor.userId })
        .where(eq(departments.id, current.id))
        .returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateCode(String(after.code))
      throw err
    }
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'departments',
      rowId: current.id,
      op: 'update',
      before,
      after,
      layer: layerKey({ kind: 'department', id: current.id }),
      clientTs: input.clientTs,
    })
    return updated
  })
}
