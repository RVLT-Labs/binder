import { describe, expect, test } from 'vitest'
import { fromPopplerBbox } from './fromPopplerBbox'

const A4 = { width: 595.3, height: 841.9 }

describe('fromPopplerBbox', () => {
  test('parses poppler bbox xhtml into displayed-space words and lines', () => {
    const xhtml = `<doc><page width="595.3" height="841.9"><block><line xMin="72" yMin="80" xMax="140" yMax="92"><word xMin="72" yMin="80" xMax="100" yMax="92">THE</word><word xMin="104" yMin="80" xMax="140" yMax="92">PIRATES</word></line></block></page></doc>`
    const layer = fromPopplerBbox(xhtml, A4)
    expect(layer.words[0]).toEqual({ t: 'THE', x: 72, y: 841.9 - 92, w: 28, h: 12 })
    expect(layer.words[1]).toEqual({ t: 'PIRATES', x: 104, y: 841.9 - 92, w: 36, h: 12 })
    expect(layer.lines).toEqual([[0, 1]])
  })

  test('flips y with the displayed height, not the unrotated <page> height', () => {
    // A /Rotate 90 A4 page: poppler reports the <page> unrotated (595 x 842) while the word
    // boxes sit in the displayed 842 x 595 frame with a top-left origin.
    const xhtml = `<doc>
  <page width="595.280000" height="841.890000">
    <flow>
      <block xMin="40.000000" yMin="42.768000" xMax="154.672000" yMax="64.968000">
        <line xMin="40.000000" yMin="42.768000" xMax="154.672000" yMax="64.968000">
          <word xMin="40.000000" yMin="42.768000" xMax="154.672000" yMax="64.968000">ROTATED</word>
        </line>
      </block>
    </flow>
  </page>
</doc>`
    const displayed = { width: 841.89, height: 595.28 }
    const [word] = fromPopplerBbox(xhtml, displayed).words
    expect(word?.t).toBe('ROTATED')
    expect(word?.x).toBeCloseTo(40)
    expect(word?.y).toBeCloseTo(595.28 - 64.968)
    expect(word?.w).toBeCloseTo(114.672)
    expect(word?.h).toBeCloseTo(22.2)
  })

  test('numbers words across lines and blocks in document order', () => {
    const w = (t: string, x: number, y: number) =>
      `<word xMin="${x}" yMin="${y}" xMax="${x + 10}" yMax="${y + 10}">${t}</word>`
    const xhtml = `<doc><page width="100" height="200">
      <flow><block>
        <line>${w('a', 0, 0)}${w('b', 20, 0)}</line>
        <line>${w('c', 0, 20)}</line>
      </block></flow>
      <flow><block><line>${w('d', 0, 40)}${w('e', 20, 40)}${w('f', 40, 40)}</line></block></flow>
    </page></doc>`
    const layer = fromPopplerBbox(xhtml, { width: 100, height: 200 })
    expect(layer.words.map((x) => x.t)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(layer.lines).toEqual([[0, 1], [2], [3, 4, 5]])
    expect(layer.words[3]).toEqual({ t: 'd', x: 0, y: 150, w: 10, h: 10 })
  })

  test('decodes XML entities in words', () => {
    const xhtml = `<doc><page width="100" height="100"><flow><block><line>
      <word xMin="0" yMin="0" xMax="1" yMax="1">R&amp;D</word>
      <word xMin="1" yMin="0" xMax="2" yMax="1">&lt;cue&gt;</word>
      <word xMin="2" yMin="0" xMax="3" yMax="1">&quot;Ruth&apos;s&quot;</word>
      <word xMin="3" yMin="0" xMax="4" yMax="1">caf&#233;&#xe9;&#x2014;</word>
      <word xMin="4" yMin="0" xMax="5" yMax="1">&amp;lt;</word>
    </line></block></flow></page></doc>`
    expect(fromPopplerBbox(xhtml, { width: 100, height: 100 }).words.map((w) => w.t)).toEqual([
      'R&D',
      '<cue>',
      '"Ruth\'s"',
      'caféé—',
      '&lt;',
    ])
  })

  test('an empty page gives an empty layer', () => {
    const xhtml = `<doc>\n  <page width="595.280000" height="841.890000">\n  </page>\n</doc>`
    expect(fromPopplerBbox(xhtml, A4)).toEqual({ words: [], lines: [] })
  })

  test('ignores markup outside the page, such as the head title', () => {
    const xhtml = `<html><head><title>word</title><meta name="Title" content="x"/></head><body><doc><page width="10" height="10"><flow><block><line><word xMin="1" yMin="2" xMax="3" yMax="4">only</word></line></block></flow></page></doc></body></html>`
    expect(fromPopplerBbox(xhtml, { width: 10, height: 10 })).toEqual({
      words: [{ t: 'only', x: 1, y: 6, w: 2, h: 2 }],
      lines: [[0]],
    })
  })
})
