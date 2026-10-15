import { helveticaWidth } from '@binder/core'
import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CueMarker, cueAccessibleName } from './CueMarker'
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
  const width = helveticaWidth('LX 10.5', 10) + 8
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

test('the accessible name gives the marker text, the label, and the page', () => {
  expect(cueAccessibleName(cue)).toBe('LX 10.5, Sunrise, page 1')
  expect(
    cueAccessibleName({ ...cue, type: 'warn', label: '', anchor: { ...cue.anchor, pageIndex: 1 } }),
  ).toBe('W LX 10.5, page 2')
})

test('a marker is a focusable, labelled button that reports whether it is selected', () => {
  const { getByRole, rerender } = render(
    <svg aria-label="Page 1 markup">
      <CueMarker cue={cue} selected={false} />
    </svg>,
  )
  const button = getByRole('button', { name: 'LX 10.5, Sunrise, page 1' })
  expect(button.getAttribute('tabindex')).toBe('0')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  rerender(
    <svg aria-label="Page 1 markup">
      <CueMarker cue={cue} selected />
    </svg>,
  )
  expect(
    getByRole('button', { name: 'LX 10.5, Sunrise, page 1' }).getAttribute('aria-pressed'),
  ).toBe('true')
})

test('Enter and Space activate a focused marker; other keys do not', () => {
  const onActivate = vi.fn()
  const { getByRole } = render(
    <svg aria-label="Page 1 markup">
      <CueMarker cue={cue} selected={false} onActivate={onActivate} />
    </svg>,
  )
  const button = getByRole('button', { name: 'LX 10.5, Sunrise, page 1' })
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.keyDown(button, { key: 'a' })
  expect(onActivate).toHaveBeenCalledTimes(2)
})
