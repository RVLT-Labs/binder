import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CueMarker, markerTextWidth } from './CueMarker'
import { SvgText } from './SvgText'

test('SvgText counter-flips so text inside the y-up overlay reads upright', () => {
  const { container } = render(
    <svg aria-hidden="true">
      <SvgText x={12} y={34}>
        LX 10
      </SvgText>
    </svg>,
  )
  const text = container.querySelector('text') as SVGTextElement
  expect(text.getAttribute('transform')).toBe('translate(12 34) scale(1 -1)')
  expect(text.getAttribute('x')).toBeNull()
  expect(text.textContent).toBe('LX 10')
})

test('marker text width follows Helvetica metrics', () => {
  // "LX 10": L 556 + X 667 + space 278 + 1 556 + 0 556 = 2613 thousandths of an em.
  expect(markerTextWidth('LX 10', 10)).toBeCloseTo(26.13)
  expect(markerTextWidth('', 10)).toBe(0)
})

const cue = {
  id: 'c1',
  type: 'go' as const,
  label: 'Sunrise',
  major: 10,
  minor: 50,
  anchor: { pageIndex: 0, x: 100, y: 500 },
  dept_code: 'LX',
  dept_colour: '#F5A623',
  dept_number_format: 'decimal' as const,
}

test('a go marker is a solid box in the department colour with its label to the right', () => {
  const { container } = render(
    <svg aria-hidden="true">
      <CueMarker cue={cue} selected={false} />
    </svg>,
  )
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('LX 10.5')
  const box = g.querySelector('rect.cue-marker-box') as SVGRectElement
  const width = markerTextWidth('LX 10.5', 10) + 8
  expect(box.getAttribute('x')).toBe('100')
  expect(box.getAttribute('y')).toBe('493')
  expect(Number(box.getAttribute('width'))).toBeCloseTo(width)
  expect(box.getAttribute('height')).toBe('14')
  expect(box.getAttribute('fill')).toBe('#F5A623')
  const [number, label] = [...g.querySelectorAll('text')]
  expect(number?.textContent).toBe('LX 10.5')
  expect(label?.textContent).toBe('Sunrise')
  expect(label?.getAttribute('fill')).toBe('#F5A623')
  // A white halo behind the label keeps it readable where it crosses the script's text.
  expect(label?.getAttribute('stroke')).toBe('#fff')
  expect(label?.getAttribute('paint-order')).toBe('stroke')
  expect(
    Number(/translate\(([\d.]+) /.exec(label?.getAttribute('transform') ?? '')?.[1]),
  ).toBeGreaterThan(100 + width)
  expect(g.querySelector('.cue-marker-selection')).toBeNull()
})

test('standby markers are dashed outlines on a white backing, and a selected marker is outlined', () => {
  const { container } = render(
    <svg aria-hidden="true">
      <CueMarker cue={{ ...cue, type: 'standby', label: '' }} selected />
    </svg>,
  )
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('SB LX 10.5')
  const box = g.querySelector('rect.cue-marker-box') as SVGRectElement
  // Not filled with the colour: a white backing keeps the number readable over the script's text.
  expect(box.getAttribute('fill')).toBe('#fff')
  expect(box.getAttribute('fill-opacity')).toBe('0.85')
  expect(box.getAttribute('stroke')).toBe('#F5A623')
  expect(box.getAttribute('stroke-dasharray')).not.toBeNull()
  expect(g.querySelectorAll('text')).toHaveLength(1)
  expect(g.getAttribute('data-selected')).toBe('true')
  expect(g.querySelector('.cue-marker-selection')).not.toBeNull()
})
