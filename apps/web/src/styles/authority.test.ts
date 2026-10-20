import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test('B01 local visual authority points to pinned canonical rules before mockups', () => {
  for (const file of ['DESIGN.md', 'CLAUDE.md']) {
    const doc = readFileSync(join(import.meta.dirname, '../../../..', file), 'utf8')
    expect(doc).toContain('f1a1825a0e07d9df56b3133151299dcd25216f9c')
    expect(doc).toContain('docs/AUTHORITY.md')
    expect(doc).toContain('§19.2')
    expect(doc).not.toContain('the mockup wins')
    expect(doc).not.toContain('**mockups are the binding visual standard**')
  }
})
