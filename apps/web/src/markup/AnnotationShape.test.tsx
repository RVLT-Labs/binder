import type { WordLayer } from '@binder/shared'
import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  AnnotationShape,
  annotationAccessibleName,
  type ShapeAnnotation,
  toShapeAnnotation,
  wrapText,
} from './AnnotationShape'

const base = (over: Partial<ShapeAnnotation>): ShapeAnnotation => ({
  id: 'a1',
  type: 'rect',
  anchor: { pageIndex: 1, x: 100, y: 200 },
  geometry: { w: 50, h: 40 },
  text: '',
  style: {},
  ...over,
})

function shape(a: ShapeAnnotation, extra: Partial<Parameters<typeof AnnotationShape>[0]> = {}) {
  return render(
    // biome-ignore lint/a11y/noSvgWithoutTitle: a test harness for overlay shapes
    <svg>
      <AnnotationShape
        annotation={a}
        layerColour="#F5A623"
        layerName="LX"
        words={null}
        selected={false}
        movable={false}
        interactive
        {...extra}
      />
    </svg>,
  )
}

test('a department shape is named by its layer, type and page', () => {
  expect(annotationAccessibleName(base({}), 'LX')).toBe('LX rect, page 2')
  expect(annotationAccessibleName(base({ type: 'arrow', geometry: { dx: 5, dy: 5 } }), 'SND')).toBe(
    'SND arrow, page 2',
  )
})

test('a note is named by its first words, a stamp by its text, a highlight by its quote', () => {
  const note = base({
    type: 'note',
    text: 'Cover the gap before the scene change',
    anchor: { pageIndex: 1, x: 0, y: 0 },
  })
  expect(annotationAccessibleName(note, 'Personal')).toBe(
    'Personal note: Cover the gap before the…, page 2',
  )
  expect(annotationAccessibleName({ ...note, text: 'Short one' }, 'Personal')).toBe(
    'Personal note: Short one, page 2',
  )
  expect(annotationAccessibleName(base({ type: 'stamp', text: 'Fly in' }), 'LX')).toBe(
    'LX stamp: Fly in, page 2',
  )
  const highlight = base({
    type: 'highlight',
    anchor: {
      pageIndex: 0,
      x: 0,
      y: 0,
      text: { quote: 'to be or not to be', wordStart: 1, wordEnd: 6 },
    },
  })
  expect(annotationAccessibleName(highlight, 'LX')).toBe('LX highlight: to be or not to…, page 1')
})

test('a shape is a focusable button that reports whether it is selected', () => {
  const { getByRole, rerender } = shape(base({}))
  const el = getByRole('button', { name: 'LX rect, page 2' })
  expect(el.getAttribute('tabindex')).toBe('0')
  expect(el.getAttribute('aria-pressed')).toBe('false')
  expect(el.getAttribute('data-annotation-id')).toBe('a1')
  rerender(
    // biome-ignore lint/a11y/noSvgWithoutTitle: a test harness for overlay shapes
    <svg>
      <AnnotationShape
        annotation={base({})}
        layerColour="#F5A623"
        layerName="LX"
        words={null}
        selected
        movable
        interactive
      />
    </svg>,
  )
  expect(getByRole('button', { name: 'LX rect, page 2' }).getAttribute('aria-pressed')).toBe('true')
  expect(getByRole('button').getAttribute('data-selected')).toBe('true')
})

test('Enter and Space select the shape; other keys do not', () => {
  const onActivate = vi.fn()
  const { getByRole } = shape(base({}), { onActivate })
  const el = getByRole('button')
  fireEvent.keyDown(el, { key: 'a' })
  expect(onActivate).not.toHaveBeenCalled()
  fireEvent.keyDown(el, { key: 'Enter' })
  fireEvent.keyDown(el, { key: ' ' })
  expect(onActivate).toHaveBeenCalledTimes(2)
})

test('shapes ignore the pointer while another tool is active', () => {
  const { getByRole } = shape(base({}), { interactive: false })
  expect(getByRole('button').style.pointerEvents).toBe('none')
})

test('a shape draws in its own colour, or the layer colour', () => {
  const own = shape(base({ style: { colour: '#112233', strokeWidth: 3 } }))
  const rect = own.container.querySelector('rect.annotation-rect')
  expect(rect?.getAttribute('stroke')).toBe('#112233')
  expect(rect?.getAttribute('stroke-width')).toBe('3')
  own.unmount()
  const layer = shape(base({}))
  expect(layer.container.querySelector('rect.annotation-rect')?.getAttribute('stroke')).toBe(
    '#F5A623',
  )
})

const words: WordLayer = {
  words: [
    { t: 'to', x: 50, y: 700, w: 20, h: 10 },
    { t: 'be', x: 75, y: 700, w: 20, h: 10 },
    { t: 'or', x: 50, y: 680, w: 20, h: 10 },
    { t: 'not', x: 75, y: 680, w: 20, h: 10 },
  ],
  lines: [
    [0, 1],
    [2, 3],
  ],
}

test('a highlight draws one rectangle per covered line', () => {
  const h = base({
    type: 'highlight',
    geometry: {},
    anchor: {
      pageIndex: 0,
      x: 50,
      y: 705,
      text: { quote: 'to be or not', wordStart: 0, wordEnd: 3 },
    },
  })
  const { container } = shape(h, { words })
  expect(container.querySelectorAll('rect.annotation-highlight')).toHaveLength(2)
  expect(container.querySelector('[data-unbound]')).toBeNull()
})

test('a highlight whose words are unbound is a dashed marker at its anchor', () => {
  const h = base({
    type: 'highlight',
    geometry: {},
    anchor: {
      pageIndex: 0,
      x: 60,
      y: 300,
      text: { quote: 'to be or not', wordStart: -1, wordEnd: -1 },
    },
  })
  const { container } = shape(h, { words })
  expect(container.querySelectorAll('rect.annotation-highlight')).toHaveLength(0)
  const marker = container.querySelector('[data-unbound]')
  expect(marker).not.toBeNull()
  const box = marker?.querySelector('rect')
  expect(box?.getAttribute('stroke-dasharray')).toBeTruthy()
  expect(Number(box?.getAttribute('x'))).toBeLessThanOrEqual(60)
  expect(container.textContent).toContain('to be or not')
})

test('wrapText breaks at the width and on new lines, never mid-word unless a word is too long', () => {
  expect(wrapText('one two three four', 10, 1000)).toEqual(['one two three four'])
  expect(wrapText('a\nb', 10, 1000)).toEqual(['a', 'b'])
  const lines = wrapText('alpha beta gamma delta epsilon', 10, 60)
  expect(lines.length).toBeGreaterThan(1)
  expect(lines.join(' ')).toBe('alpha beta gamma delta epsilon')
  expect(wrapText('', 10, 60)).toEqual([''])
})

test('toShapeAnnotation reads a local row: parsed anchor, JSON geometry and style as text', () => {
  const anchor = {
    documentId: 'd',
    documentVersionId: 'v',
    pageIndex: 3,
    x: 1,
    y: 2,
    status: 'ok' as const,
  }
  const shape = toShapeAnnotation({
    id: 'a9',
    show_id: 's',
    layer_kind: 'department',
    layer_id: 'lx',
    anchor,
    type: 'ellipse',
    geometry: '{"w":10,"h":20}',
    text: '',
    style: '{"colour":"#112233"}',
    created_at: null,
    updated_at: null,
    updated_by: null,
  })
  expect(shape).toMatchObject({
    id: 'a9',
    type: 'ellipse',
    geometry: { w: 10, h: 20 },
    style: { colour: '#112233' },
    anchor: { pageIndex: 3, x: 1, y: 2 },
  })
  // A row with broken JSON still draws (as nothing sensible) rather than throwing.
  expect(
    toShapeAnnotation({ ...shape, geometry: 'oops', style: null, anchor } as never).geometry,
  ).toEqual({})
})

test('a note is a tinted block with a 2 pt left bar in its colour, no outline, text in page ink', () => {
  const { container } = shape(
    base({ type: 'note', text: 'ride the pad', anchor: { pageIndex: 1, x: 100, y: 200 } }),
  )
  const body = container.querySelector('rect.annotation-note') as SVGRectElement
  // #F5A623 mixed 12 % into white.
  expect(body.getAttribute('fill')).toBe('#fef4e5')
  expect(body.getAttribute('stroke')).toBeNull()
  expect(body.getAttribute('fill-opacity')).toBeNull()
  const bar = container.querySelector('rect.annotation-note-bar') as SVGRectElement
  expect(bar.getAttribute('width')).toBe('2')
  expect(bar.getAttribute('fill')).toBe('#F5A623')
  expect(bar.getAttribute('x')).toBe(body.getAttribute('x'))
  expect(container.querySelector('text')?.getAttribute('fill')).toBe('var(--page-ink)')
})

test('a stamp is bold, letter-spaced and turned 3 degrees about its centre, 1.5 border, 80 % fill', () => {
  const { container } = shape(
    base({ type: 'stamp', text: 'FAST PACE', anchor: { pageIndex: 1, x: 100, y: 200 } }),
  )
  const turn = container.querySelector('rect.annotation-stamp')?.parentElement
  expect(turn?.getAttribute('transform')).toBe('rotate(3 100 200)')
  const rect = container.querySelector('rect.annotation-stamp') as SVGRectElement
  expect(rect.getAttribute('rx')).toBe('3')
  expect(rect.getAttribute('stroke-width')).toBe('1.5')
  expect(rect.getAttribute('fill-opacity')).toBe('0.8')
  const text = container.querySelector('text') as SVGTextElement
  expect(text.getAttribute('font-weight')).toBe('800')
  expect(text.getAttribute('letter-spacing')).toBe('0.06em')
})

test('a selected shape gets a 2 px red ring that does not scale with the page', () => {
  const { container } = shape(base({}), { selected: true })
  const ring = container.querySelector('.annotation-selection') as SVGRectElement
  expect(ring.getAttribute('stroke')).toBe('var(--red)')
  expect(ring.getAttribute('stroke-width')).toBe('2')
  expect(ring.getAttribute('vector-effect')).toBe('non-scaling-stroke')
  expect(ring.getAttribute('stroke-dasharray')).toBeNull()
  expect(Number(ring.getAttribute('x'))).toBe(100 - 3)
})
