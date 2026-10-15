import { type CueTagLayout, helveticaWidth } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CueMarker, CueTrigger, cueAccessibleName } from './CueMarker'
import { type LayoutCue, layoutPageCues } from './cueLayout'
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

const cue: LayoutCue = {
  id: 'c1',
  type: 'go',
  label: 'Sunrise',
  major: 10,
  minor: 50,
  anchor: { pageIndex: 0, x: 100, y: 500 },
  dept_code: 'LX',
  dept_colour: '#F5A623',
  dept_number_format: 'decimal',
}

/** Words on the cue's line: "up the hill" at x 200, 230, 260 and a line below. */
const words: WordLayer = {
  words: [
    { t: 'up', x: 200, y: 495, w: 20, h: 10 },
    { t: 'the', x: 224, y: 495, w: 24, h: 10 },
    { t: 'hill', x: 252, y: 495, w: 24, h: 10 },
  ],
  lines: [[0, 1, 2]],
}
const bound = {
  ...cue,
  anchor: { ...cue.anchor, text: { quote: 'the hill', wordStart: 1, wordEnd: 2 } },
}

function tagOf(c: LayoutCue, side: 'left' | 'right' = 'left') {
  const tag = layoutPageCues(
    [c],
    words,
    600,
    () => side,
    () => 0,
  ).get(c.id)
  if (!tag) throw new Error('no layout')
  return tag
}

const draw = (
  c: typeof cue,
  tag: CueTagLayout,
  props: Partial<Parameters<typeof CueMarker>[0]> = {},
) =>
  render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={c} tag={tag} interactive />
      <CueMarker cue={c} tag={tag} selected={false} {...props} />
    </svg>,
  )

test('a go marker is an opaque white tag in the margin with a coloured bar, the code, a divider and the number', () => {
  const { container } = draw(cue, tagOf(cue))
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('LX 10.5')
  const body = g.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(body.getAttribute('x')).toBe('4')
  expect(body.getAttribute('y')).toBe('493')
  expect(body.getAttribute('height')).toBe('14')
  expect(Number(body.getAttribute('width'))).toBeCloseTo(
    4 + 4 + helveticaWidth('LX', 9) + 4 + 0.75 + 4 + helveticaWidth('10.5', 9) + 4,
  )
  // Opaque white, outlined 1 pt in the department colour, solid.
  expect(body.getAttribute('fill')).toBe('#fff')
  expect(body.getAttribute('fill-opacity')).toBeNull()
  expect(body.getAttribute('stroke')).toBe('#F5A623')
  expect(body.getAttribute('stroke-width')).toBe('1')
  expect(body.getAttribute('stroke-dasharray')).toBeNull()
  const bar = g.querySelector('rect.cue-tag-bar') as SVGRectElement
  expect(bar.getAttribute('fill')).toBe('#F5A623')
  expect(bar.getAttribute('x')).toBe('4')
  expect(bar.getAttribute('width')).toBe('4')
  expect(g.querySelectorAll('circle.cue-tag-grip')).toHaveLength(3)
  expect(g.querySelector('.cue-tag-divider')).not.toBeNull()
  const texts = [...g.querySelectorAll('text')].map((t) => t.textContent)
  // Only the code and number: the label is never drawn on the page.
  expect(texts).toEqual(['LX', '10.5'])
  expect(g.querySelector('.cue-marker-selection')).toBeNull()
})

test('the cue label is in a title on the tag for hover, and not drawn as text', () => {
  const { container } = draw(cue, tagOf(cue))
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.querySelector('title')?.textContent).toBe('LX 10.5, Sunrise')
  expect([...container.querySelectorAll('text')].some((t) => t.textContent === 'Sunrise')).toBe(
    false,
  )
})

test('standby is a dashed outline with the SB prefix, warn a solid one with W; selection is outlined', () => {
  const standby = { ...cue, type: 'standby' as const, label: '' }
  const { container } = draw(standby, tagOf(standby), { selected: true })
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('SB LX 10.5')
  const body = g.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(body.getAttribute('fill')).toBe('#fff')
  expect(body.getAttribute('stroke-dasharray')).not.toBeNull()
  expect([...g.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['SB LX', '10.5'])
  expect(g.getAttribute('data-selected')).toBe('true')
  expect(g.querySelector('.cue-marker-selection')).not.toBeNull()
  expect(g.querySelector('title')?.textContent).toBe('SB LX 10.5')
  const warn = render(
    <svg aria-label="Page 1 markup">
      <CueMarker
        cue={{ ...cue, type: 'warn' }}
        tag={tagOf({ ...cue, type: 'warn' })}
        selected={false}
      />
    </svg>,
  ).container
  const wb = warn.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(wb.getAttribute('stroke-dasharray')).toBeNull()
  expect([...warn.querySelectorAll('text')][0]?.textContent).toBe('W LX')
})

test('a right-side tag ends 4 points inside the right edge, its bar outermost', () => {
  const { container } = draw(cue, tagOf(cue, 'right'))
  const body = container.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(Number(body.getAttribute('x')) + Number(body.getAttribute('width'))).toBeCloseTo(596)
  const bar = container.querySelector('rect.cue-tag-bar') as SVGRectElement
  expect(Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))).toBeCloseTo(596)
})

test('a bound cue highlights its trigger words and joins them to the tag with a leader, both hidden from assistive technology', () => {
  const { container } = draw(bound, tagOf(bound))
  const trigger = container.querySelector('.cue-trigger') as SVGGElement
  expect(trigger.getAttribute('aria-hidden')).toBe('true')
  const highlights = [...trigger.querySelectorAll('rect.cue-highlight')]
  expect(highlights).toHaveLength(1)
  const h = highlights[0] as SVGRectElement
  // "the hill" (224 to 276), padded 1.5.
  expect(h.getAttribute('x')).toBe('222.5')
  expect(h.getAttribute('width')).toBe('55')
  expect(h.getAttribute('fill')).toBe('#F5A623')
  expect(h.getAttribute('fill-opacity')).toBe('0.15')
  expect(h.getAttribute('stroke')).toBe('#F5A623')
  expect(h.getAttribute('stroke-width')).toBe('0.75')
  const leader = trigger.querySelector('line.cue-leader') as SVGLineElement
  expect(leader.getAttribute('stroke')).toBe('#F5A623')
  expect(Number(leader.getAttribute('x2'))).toBeCloseTo(222.5)
  expect(leader.getAttribute('y1')).toBe('493')
  expect(trigger.querySelector('.cue-tick')).toBeNull()
})

test('an unbound cue has a tick at its anchor instead of a highlight', () => {
  const { container } = draw(cue, tagOf(cue))
  const trigger = container.querySelector('.cue-trigger') as SVGGElement
  expect(trigger.querySelector('rect.cue-highlight')).toBeNull()
  const tick = trigger.querySelector('line.cue-tick') as SVGLineElement
  expect(tick.getAttribute('x1')).toBe('100')
  expect(tick.getAttribute('y1')).toBe('496')
  expect(tick.getAttribute('y2')).toBe('504')
  expect(trigger.querySelector('line.cue-leader')).not.toBeNull()
})

test('clicking the highlight selects the cue; with another tool it does not take the pointer', () => {
  const onActivate = vi.fn()
  const tag = tagOf(bound)
  const { container, rerender } = render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={bound} tag={tag} interactive onActivate={onActivate} />
    </svg>,
  )
  const highlight = container.querySelector('rect.cue-highlight') as SVGRectElement
  fireEvent.click(highlight)
  expect(onActivate).toHaveBeenCalledOnce()
  expect(highlight.style.pointerEvents).toBe('auto')
  rerender(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={bound} tag={tag} interactive={false} onActivate={onActivate} />
    </svg>,
  )
  expect(
    (container.querySelector('rect.cue-highlight') as SVGRectElement).style.pointerEvents,
  ).toBe('none')
})

test('the accessible name gives the marker text, the label, and the page', () => {
  expect(cueAccessibleName(cue)).toBe('LX 10.5, Sunrise, page 1')
  expect(
    cueAccessibleName({ ...cue, type: 'warn', label: '', anchor: { ...cue.anchor, pageIndex: 1 } }),
  ).toBe('W LX 10.5, page 2')
})

test('a marker is a focusable, labelled button that reports whether it is selected', () => {
  const tag = tagOf(cue)
  const { getByRole, rerender } = draw(cue, tag)
  const button = getByRole('button', { name: 'LX 10.5, Sunrise, page 1' })
  expect(button.getAttribute('tabindex')).toBe('0')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  rerender(
    <svg aria-label="Page 1 markup">
      <CueMarker cue={cue} tag={tag} selected />
    </svg>,
  )
  expect(
    getByRole('button', { name: 'LX 10.5, Sunrise, page 1' }).getAttribute('aria-pressed'),
  ).toBe('true')
})

test('Enter and Space activate a focused marker; other keys do not', () => {
  const onActivate = vi.fn()
  const { getByRole } = draw(cue, tagOf(cue), { onActivate })
  const button = getByRole('button', { name: 'LX 10.5, Sunrise, page 1' })
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.keyDown(button, { key: 'a' })
  expect(onActivate).toHaveBeenCalledTimes(2)
})

test('only the tag is a button: the highlight and leader are not in the accessibility tree', () => {
  const { getAllByRole } = draw(bound, tagOf(bound))
  expect(getAllByRole('button')).toHaveLength(1)
})
