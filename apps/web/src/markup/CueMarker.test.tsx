import { type CueTagLayout, helveticaBoldWidth, helveticaWidth } from '@binder/core'
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
    { width: 600, height: 800 },
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

test('B05/B16 a go marker preserves geometry with the entire label in page ink', () => {
  const { container } = draw(cue, tagOf(cue))
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('LX 10.5')
  const body = g.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(body.getAttribute('x')).toBe('4')
  expect(body.getAttribute('y')).toBe('493')
  expect(body.getAttribute('height')).toBe('14')
  // A pill: a radius of half the height.
  expect(body.getAttribute('rx')).toBe('7')
  expect(Number(body.getAttribute('width'))).toBeCloseTo(
    6 + helveticaWidth('LX', 9) + 3 + helveticaBoldWidth('10.5', 9) + 6,
  )
  // Opaque white, outlined 1 pt in the department colour, solid.
  expect(body.getAttribute('fill')).toBe('var(--page)')
  expect(body.getAttribute('fill-opacity')).toBeNull()
  expect(body.getAttribute('stroke')).toBe('#F5A623')
  expect(body.getAttribute('stroke-width')).toBe('1')
  expect(body.getAttribute('stroke-dasharray')).toBeNull()
  // No edge bar, grip dots or divider.
  expect(g.querySelector('.cue-tag-bar, .cue-tag-grip, .cue-tag-divider')).toBeNull()
  const [lead, number] = [...g.querySelectorAll('text')]
  expect([lead?.textContent, number?.textContent]).toEqual(['LX', '10.5'])
  expect(lead?.getAttribute('fill')).toBe('var(--page-ink)')
  expect(number?.getAttribute('fill')).toBe('var(--page-ink)')
  expect(number?.getAttribute('font-weight')).toBe('700')
  expect(lead?.getAttribute('font-weight')).toBeNull()
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

test('standby is a dashed 1 pt outline with the SB prefix, warn a solid 1.5 pt one with W; selection is outlined', () => {
  const standby = { ...cue, type: 'standby' as const, label: '' }
  const { container } = draw(standby, tagOf(standby), { selected: true })
  const g = container.querySelector('[data-cue-id="c1"]') as SVGGElement
  expect(g.getAttribute('data-cue-label')).toBe('SB LX 10.5')
  const body = g.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(body.getAttribute('fill')).toBe('var(--page)')
  expect(body.getAttribute('stroke-dasharray')).not.toBeNull()
  expect(body.getAttribute('stroke-width')).toBe('1')
  expect([...g.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['SB LX', '10.5'])
  expect(g.getAttribute('data-selected')).toBe('true')
  const sel = g.querySelector('.cue-marker-selection') as SVGRectElement
  // The mockup's .sel: a solid 2 px red outline 3 pt out from the tag (2 px offset + half the stroke).
  expect(sel.getAttribute('stroke')).toBe('var(--red)')
  expect(sel.getAttribute('stroke-width')).toBe('2')
  expect(sel.getAttribute('stroke-dasharray')).toBeNull()
  expect(sel.getAttribute('vector-effect')).toBe('non-scaling-stroke')
  expect(Number(sel.getAttribute('x'))).toBe(Number(body.getAttribute('x')) - 3)
  expect(Number(sel.getAttribute('width'))).toBe(Number(body.getAttribute('width')) + 6)
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
  expect(wb.getAttribute('stroke-width')).toBe('1.5')
  expect([...warn.querySelectorAll('text')][0]?.textContent).toBe('W LX')
})

test('a right-side tag ends 4 points inside the right edge', () => {
  const { container } = draw(cue, tagOf(cue, 'right'))
  const body = container.querySelector('rect.cue-tag-body') as SVGRectElement
  expect(Number(body.getAttribute('x')) + Number(body.getAttribute('width'))).toBeCloseTo(596)
})

test('a bound cue underlines its trigger words and joins them to the tag with a connector, both hidden from assistive technology', () => {
  const { container } = draw(bound, tagOf(bound))
  const trigger = container.querySelector('.cue-trigger') as SVGGElement
  expect(trigger.getAttribute('aria-hidden')).toBe('true')
  const underlines = [...trigger.querySelectorAll('line.cue-underline')]
  expect(underlines).toHaveLength(1)
  const u = underlines[0] as SVGLineElement
  // "the hill" (224 to 276), 1 pt under the word box's bottom edge (495).
  expect(u.getAttribute('x1')).toBe('224')
  expect(u.getAttribute('x2')).toBe('276')
  expect(u.getAttribute('y1')).toBe('494')
  expect(u.getAttribute('stroke')).toBe('#F5A623')
  expect(u.getAttribute('stroke-width')).toBe('1.5')
  const leader = trigger.querySelector('polyline.cue-leader') as SVGPolylineElement
  expect(leader.getAttribute('stroke')).toBe('#F5A623')
  // At the underline's y, so it never crosses a glyph, and ending at the underline's start.
  const points = (leader.getAttribute('points') ?? '').split(' ')
  expect(points.at(-1)).toBe('224,494')
  expect(points.every((p) => p.endsWith(',494'))).toBe(true)
  expect(trigger.querySelector('.cue-tick')).toBeNull()
  // Not filled unless selected or hovered.
  expect(trigger.querySelector('rect.cue-highlight')?.getAttribute('fill-opacity')).toBe('0')
})

test('a selected or hovered cue fills its trigger words with 10% of its colour', () => {
  const tag = tagOf(bound)
  const { container } = render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={bound} tag={tag} interactive filled />
    </svg>,
  )
  const h = container.querySelector('rect.cue-highlight') as SVGRectElement
  expect(h.getAttribute('fill')).toBe('#F5A623')
  expect(h.getAttribute('fill-opacity')).toBe('0.1')
  expect(h.getAttribute('x')).toBe('224')
  expect(h.getAttribute('width')).toBe('52')
})

test('hovering the trigger words reports the hover', () => {
  const onHover = vi.fn()
  const { container } = render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={bound} tag={tagOf(bound)} interactive onHover={onHover} />
    </svg>,
  )
  const h = container.querySelector('rect.cue-highlight') as SVGRectElement
  fireEvent.pointerEnter(h)
  fireEvent.pointerLeave(h)
  expect(onHover.mock.calls).toEqual([[true], [false]])
})

test('an unbound cue has a tick at its anchor instead of an underline', () => {
  const { container } = draw(cue, tagOf(cue))
  const trigger = container.querySelector('.cue-trigger') as SVGGElement
  expect(trigger.querySelector('line.cue-underline')).toBeNull()
  expect(trigger.querySelector('rect.cue-highlight')).toBeNull()
  const tick = trigger.querySelector('line.cue-tick') as SVGLineElement
  expect(tick.getAttribute('x1')).toBe('100')
  expect(tick.getAttribute('y1')).toBe('493')
  expect(tick.getAttribute('y2')).toBe('504')
  expect(trigger.querySelector('polyline.cue-leader')).not.toBeNull()
})

test('clicking the trigger words selects the cue; with another tool they do not take the pointer', () => {
  const onActivate = vi.fn()
  const tag = tagOf(bound)
  const { container, rerender } = render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={bound} tag={tag} interactive onActivate={onActivate} />
    </svg>,
  )
  const words = container.querySelector('rect.cue-highlight') as SVGRectElement
  fireEvent.click(words)
  expect(onActivate).toHaveBeenCalledOnce()
  expect(words.style.pointerEvents).toBe('auto')
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

test('only the tag is a button: the underline and connector are not in the accessibility tree', () => {
  const { getAllByRole } = draw(bound, tagOf(bound))
  expect(getAllByRole('button')).toHaveLength(1)
})

test('in a narrow margin a standby tag sheds its department and then its SB word, never its number', () => {
  const standby: LayoutCue = { ...cue, type: 'standby', label: '' }
  // The text block starts at x 62: room for "SB 10.5" (about 45 wide) but not "SB LX 10.5".
  const narrow = (minX: number): WordLayer => ({
    words: [{ t: 'a', x: minX, y: 495, w: 20, h: 10 }],
    lines: [[0]],
  })
  const render1 = (minX: number) => {
    const tag = layoutPageCues(
      [standby],
      narrow(minX),
      { width: 600, height: 800 },
      () => 'left',
      () => 0,
    ).get('c1')
    if (!tag) throw new Error('no layout')
    return draw(standby, tag).container
  }
  const prefix = render1(62)
  expect([...prefix.querySelectorAll('[data-cue-id] text')].map((t) => t.textContent)).toEqual([
    'SB',
    '10.5',
  ])
  // The dashed outline still says standby.
  expect(prefix.querySelector('rect.cue-tag-body')?.getAttribute('stroke-dasharray')).not.toBeNull()
  const numberOnly = render1(36)
  expect([...numberOnly.querySelectorAll('[data-cue-id] text')].map((t) => t.textContent)).toEqual([
    '10.5',
  ])
  // The accessible name still carries the full text.
  expect(numberOnly.querySelector('[data-cue-id]')?.getAttribute('aria-label')).toBe(
    'SB LX 10.5, page 1',
  )
})

test('a tag pushed off its line draws a three-segment connector that jogs in the gutter', () => {
  const second: LayoutCue = {
    ...bound,
    id: 'c2',
    major: 11,
    minor: 0,
    anchor: { ...bound.anchor, y: 503 },
  }
  const layouts = layoutPageCues(
    [bound, second],
    words,
    { width: 600, height: 800 },
    () => 'left',
    () => 0,
  )
  const tag = layouts.get('c2')
  if (!tag) throw new Error('no layout')
  const { container } = render(
    <svg aria-label="Page 1 markup">
      <CueTrigger cue={second} tag={tag} interactive />
    </svg>,
  )
  const leader = container.querySelector('polyline.cue-leader') as SVGPolylineElement
  const points = (leader.getAttribute('points') ?? '')
    .split(' ')
    .map((p) => p.split(',').map(Number))
  expect(points).toHaveLength(4)
  // Out of the tag at its own height, then the gutter 2 points left of the text block (x 200),
  // down to the underline, then in to it.
  expect(points[1]?.[0]).toBe(198)
  expect(points[2]?.[0]).toBe(198)
  expect(points[3]?.[1]).toBe(points[2]?.[1])
  expect(points[0]?.[1]).toBe(tag.centreY)
})
