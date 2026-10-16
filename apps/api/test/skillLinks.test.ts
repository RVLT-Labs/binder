import { describe, expect, test } from 'vitest'
import { rewriteSkillLinks } from '../src/mcp/resources/skill'

describe('rewriteSkillLinks', () => {
  test('points references/ links at the skill resource', () => {
    expect(rewriteSkillLinks('see [tools](references/tools.md) now')).toBe(
      'see [tools](binder://skill/tools) now',
    )
  })

  test('points sibling links at the skill resource and keeps the anchor', () => {
    expect(rewriteSkillLinks('[x](tools.md#calling-the-endpoint-with-plain-http)')).toBe(
      '[x](binder://skill/tools#calling-the-endpoint-with-plain-http)',
    )
  })

  test('points SKILL.md at the index slug', () => {
    expect(rewriteSkillLinks('[skill](../SKILL.md)')).toBe('[skill](binder://skill/index)')
    expect(rewriteSkillLinks('[skill](SKILL.md#hard-rules)')).toBe(
      '[skill](binder://skill/index#hard-rules)',
    )
  })

  test('rewrites several links on one line', () => {
    expect(rewriteSkillLinks('[a](a-b.md) and [c](../c1.md)')).toBe(
      '[a](binder://skill/a-b) and [c](binder://skill/c1)',
    )
  })

  test('leaves http(s) links alone', () => {
    const text = '[x](https://example.test/tools.md) [y](http://example.test/SKILL.md)'
    expect(rewriteSkillLinks(text)).toBe(text)
  })

  test('leaves other relative paths alone', () => {
    const text =
      '[a](docs/mcp.md) [b](../../docs/guides/x.md) [c](image.png) [d](#anchor) [e](Tools.md)'
    expect(rewriteSkillLinks(text)).toBe(text)
  })

  test('leaves fenced code blocks alone', () => {
    const text = [
      'before [a](tools.md)',
      '```md',
      '[b](tools.md)',
      '```',
      '~~~',
      '[c](tools.md)',
      '~~~',
      'after [d](tools.md)',
    ].join('\n')
    expect(rewriteSkillLinks(text)).toBe(
      [
        'before [a](binder://skill/tools)',
        '```md',
        '[b](tools.md)',
        '```',
        '~~~',
        '[c](tools.md)',
        '~~~',
        'after [d](binder://skill/tools)',
      ].join('\n'),
    )
  })
})
