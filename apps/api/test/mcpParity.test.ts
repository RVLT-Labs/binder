import { expect, test } from 'vitest'
import { OPERATION_TO_TOOL, TOOL_NAMES, UI_ONLY_OPERATIONS } from '../src/mcp/registry'
import * as services from '../src/services'

/** Every function the service barrel exports is a service operation. */
const SERVICE_OPERATIONS = Object.entries(services)
  .filter(([, value]) => typeof value === 'function')
  .map(([name]) => name)
  .sort()

test('the service barrel exports operations to check', () => {
  expect(SERVICE_OPERATIONS.length).toBeGreaterThan(10)
})

test('every service operation is an MCP tool or has a listed exemption', () => {
  const covered = new Set([...Object.keys(OPERATION_TO_TOOL), ...Object.keys(UI_ONLY_OPERATIONS)])
  for (const op of SERVICE_OPERATIONS)
    expect(covered, `missing MCP coverage for ${op}`).toContain(op)
})

test('no operation is both a tool and exempt', () => {
  for (const op of Object.keys(OPERATION_TO_TOOL)) {
    expect(UI_ONLY_OPERATIONS, `${op} is mapped and exempt`).not.toHaveProperty(op)
  }
})

test('every mapped or exempt operation is an exported service function', () => {
  for (const op of [...Object.keys(OPERATION_TO_TOOL), ...Object.keys(UI_ONLY_OPERATIONS)]) {
    expect(SERVICE_OPERATIONS, `${op} is not an exported service function`).toContain(op)
  }
})

test('every exemption carries a reason', () => {
  for (const [op, reason] of Object.entries(UI_ONLY_OPERATIONS)) {
    expect(reason.trim(), `${op} has no reason`).not.toBe('')
  }
})

test('every mapped tool is a registered tool name', () => {
  for (const [op, tool] of Object.entries(OPERATION_TO_TOOL)) {
    expect(TOOL_NAMES, `${op} maps to unknown tool ${tool}`).toContain(tool)
  }
})
