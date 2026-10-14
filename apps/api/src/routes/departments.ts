import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import {
  createDepartment,
  listDepartments,
  listShowMembers,
  removeShowMember,
  updateDepartment,
  updateShowMember,
} from '../services'
import { departmentFields, memberDepartments } from '../validation'
import { readJson } from './json'

const createBody = z.object({
  code: departmentFields.code,
  name: departmentFields.name,
  colour: departmentFields.colour,
  numberFormat: departmentFields.numberFormat.optional(),
  sortOrder: departmentFields.sortOrder.optional(),
})
const patchBody = z
  .object({
    code: departmentFields.code.optional(),
    name: departmentFields.name.optional(),
    colour: departmentFields.colour.optional(),
    numberFormat: departmentFields.numberFormat.optional(),
    sortOrder: departmentFields.sortOrder.optional(),
    hidden: departmentFields.hidden.optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'nothing to change')
const memberPatchBody = z
  .object({
    role: z.enum(['owner', 'editor', 'viewer']).optional(),
    departments: memberDepartments.optional(),
  })
  .refine((p) => p.role !== undefined || p.departments !== undefined, 'nothing to change')

export const departments = new Hono<AppEnv>()

// biome-ignore lint/style/noNonNullAssertion: requireUser always sets actor
const actorOf = (c: { var: AppEnv['Variables'] }) => c.var.actor!

departments.get('/shows/:showId/departments', requireUser, async (c) =>
  c.json({
    departments: await listDepartments(c.var.deps.db, actorOf(c), {
      showId: c.req.param('showId'),
    }),
  }),
)

departments.post('/shows/:showId/departments', requireUser, async (c) => {
  const body = await readJson(c.req, createBody)
  const department = await createDepartment(c.var.deps.db, actorOf(c), {
    showId: c.req.param('showId'),
    ...body,
  })
  return c.json({ department }, 201)
})

departments.patch('/departments/:departmentId', requireUser, async (c) => {
  const patch = await readJson(c.req, patchBody)
  const department = await updateDepartment(c.var.deps.db, actorOf(c), {
    departmentId: c.req.param('departmentId'),
    patch,
  })
  return c.json({ department })
})

departments.get('/shows/:showId/members', requireUser, async (c) =>
  c.json({
    members: await listShowMembers(c.var.deps.db, actorOf(c), { showId: c.req.param('showId') }),
  }),
)

departments.patch('/memberships/:membershipId', requireUser, async (c) => {
  const body = await readJson(c.req, memberPatchBody)
  const membership = await updateShowMember(c.var.deps.db, actorOf(c), {
    membershipId: c.req.param('membershipId'),
    ...body,
  })
  return c.json({ membership })
})

departments.delete('/memberships/:membershipId', requireUser, async (c) => {
  const membership = await removeShowMember(c.var.deps.db, actorOf(c), {
    membershipId: c.req.param('membershipId'),
  })
  return c.json({ membership })
})
