import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// Faint is reserved for decorative marks. No text utility may assign it to readable descendants.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory()
      ? sourceFiles(path)
      : /(?<!\.test)\.tsx$/.test(entry.name)
        ? [path]
        : []
  })
}

test('B03 readable chrome and placeholders never inherit decorative faint', () => {
  const violations = sourceFiles(join(import.meta.dirname, '..')).filter((path) =>
    /\btext-faint\b/.test(readFileSync(path, 'utf8')),
  )
  expect(violations).toEqual([])
})

test('B14/B17 department data never supplies readable chrome foregrounds', () => {
  for (const file of [
    'settings/DepartmentsSection',
    'viewer/StatusBar',
    'revisions/ReviewPanel',
    'routes/shows.$showId.cues',
    'palette/CommandPalette',
  ]) {
    const source = readFileSync(join(import.meta.dirname, `../${file}.tsx`), 'utf8')
    expect(source, file).not.toMatch(/style=\{\{\s*color:|\{ color: part\.colour \}/)
  }
})
