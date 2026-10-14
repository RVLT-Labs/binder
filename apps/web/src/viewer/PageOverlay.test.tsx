import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { PageOverlay } from './PageOverlay'
import { SearchHighlights } from './SearchHighlights'

const words = [
  { t: 'The', x: 10, y: 700, w: 20, h: 10 },
  { t: 'Pirate', x: 35, y: 700, w: 30, h: 10 },
  { t: 'King', x: 70, y: 700, w: 25, h: 10 },
  { t: 'other', x: 10, y: 500, w: 25, h: 10 },
]

test('PageOverlay draws in displayed points, y up, over a page box of displayed size x zoom', () => {
  const { container } = render(
    <PageOverlay width={612} height={792} zoom={1.5}>
      <circle r="1" />
    </PageOverlay>,
  )
  const svg = container.querySelector('svg') as SVGSVGElement
  expect(svg.getAttribute('viewBox')).toBe('0 0 612 792')
  expect(svg.style.position).toBe('absolute')
  expect(svg.style.pointerEvents).toBe('none')
  expect(svg.style.width).toBe('918px')
  expect(svg.style.height).toBe('1188px')
  const g = svg.querySelector('g') as SVGGElement
  expect(g.getAttribute('transform')).toBe('translate(0 792) scale(1 -1)')
  expect(g.querySelector('circle')).not.toBeNull()
})

test('an overlay without a label is hidden from assistive technology', () => {
  const { container } = render(
    <PageOverlay width={612} height={792} zoom={1}>
      <circle r="1" />
    </PageOverlay>,
  )
  const svg = container.querySelector('svg') as SVGSVGElement
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('role')).toBeNull()
})

test('a labelled overlay is a named group that assistive technology can enter', () => {
  const { getByRole } = render(
    <PageOverlay width={612} height={792} zoom={1} label="Page 2 markup">
      {/* biome-ignore lint/a11y/useSemanticElements: stands in for an SVG cue marker */}
      <g role="button" aria-label="LX 10" tabIndex={0} />
    </PageOverlay>,
  )
  const group = getByRole('group', { name: 'Page 2 markup' })
  expect(group.getAttribute('aria-hidden')).toBeNull()
  expect(getByRole('button', { name: 'LX 10' })).toBeTruthy()
})

test('SearchHighlights draws a rect per matched word in displayed coordinates', () => {
  const hits = [
    { pageIndex: 0, lineIndex: 0, wordStart: 1, wordEnd: 2, snippet: 'Pirate King' },
    { pageIndex: 0, lineIndex: 1, wordStart: 3, wordEnd: 3, snippet: 'other' },
  ]
  const { container } = render(
    <svg aria-hidden="true">
      <SearchHighlights hits={hits} words={words} />
    </svg>,
  )
  const rects = [...container.querySelectorAll('rect')].map((r) =>
    ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a))),
  )
  expect(rects).toEqual([
    [35, 700, 30, 10],
    [70, 700, 25, 10],
    [10, 500, 25, 10],
  ])
})

test('SearchHighlights marks the active hit apart from the rest', () => {
  const hits = [
    { pageIndex: 0, lineIndex: 0, wordStart: 0, wordEnd: 0, snippet: 'The' },
    { pageIndex: 0, lineIndex: 0, wordStart: 1, wordEnd: 1, snippet: 'Pirate' },
  ]
  const { container } = render(
    <svg aria-hidden="true">
      <SearchHighlights hits={hits} words={words} active={hits[1]} />
    </svg>,
  )
  const [first, second] = [...container.querySelectorAll('rect')]
  expect(first.classList.contains('search-hit-active')).toBe(false)
  expect(second.classList.contains('search-hit-active')).toBe(true)
})

test('SearchHighlights ignores word indices the layer does not have', () => {
  const { container } = render(
    <svg aria-hidden="true">
      <SearchHighlights
        hits={[{ pageIndex: 0, lineIndex: 0, wordStart: 9, wordEnd: 9, snippet: '' }]}
        words={words}
      />
    </svg>,
  )
  expect(container.querySelectorAll('rect')).toHaveLength(0)
})
