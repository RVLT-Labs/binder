import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { PrintPreview, previewSize } from './PrintPreview'

const lx = { id: 'lx', code: 'LX', colour: '#C9811F' }
const snd = { id: 'snd', code: 'SND', colour: '#4F8BE8' }
const tm = { id: 'tm', code: 'TM', colour: '#8E7BD8' }
const sides: Record<string, 'left' | 'right'> = { lx: 'left', snd: 'right', tm: 'left' }

const draw = (over: Partial<React.ComponentProps<typeof PrintPreview>> = {}) =>
  render(
    <PrintPreview
      paper="A4"
      departments={[lx, snd, tm]}
      sideOf={(id) => sides[id] ?? 'left'}
      standbyWarn={false}
      {...over}
    />,
  )

const tags = (container: HTMLElement, id: string) =>
  [...container.querySelectorAll<SVGElement>(`[data-tag][data-dept="${id}"]`)].map((el) => ({
    side: el.getAttribute('data-side'),
    x: Number(el.querySelector('rect')?.getAttribute('x')),
  }))

test("tags land on each department's configured side", () => {
  const { container } = draw()
  const width = previewSize('A4').width
  for (const [id, side] of [
    ['lx', 'left'],
    ['snd', 'right'],
    ['tm', 'left'],
  ] as const) {
    const found = tags(container, id)
    expect(found.length).toBeGreaterThan(0)
    for (const t of found) {
      expect(t.side).toBe(side)
      // Left tags sit in the left margin, right tags in the right one.
      if (side === 'left') expect(t.x).toBeLessThan(width / 4)
      else expect(t.x).toBeGreaterThan((width * 3) / 4 - 30)
    }
  }
})

test('the mockup draws three LX tags, one TM and three SND on a full call', () => {
  const { container } = draw()
  expect([
    tags(container, 'lx').length,
    tags(container, 'snd').length,
    tags(container, 'tm').length,
  ]).toEqual([3, 3, 1])
})

test('a department moved to the other side moves its tags with it', () => {
  const { container } = draw({ sideOf: (id) => (id === 'lx' ? 'right' : 'left') })
  expect(tags(container, 'lx').every((t) => t.side === 'right')).toBe(true)
  expect(tags(container, 'snd').every((t) => t.side === 'left')).toBe(true)
})

test('the page aspect ratio follows the paper', () => {
  const a4 = previewSize('A4')
  const letter = previewSize('Letter')
  expect(a4.height / a4.width).toBeCloseTo(841.89 / 595.28, 2)
  expect(letter.height / letter.width).toBeCloseTo(792 / 612, 2)
  expect(a4.height / a4.width).toBeGreaterThan(letter.height / letter.width)
  // Both fit the mockup's 196 x 262 slot, so the dialog does not jump when the paper changes.
  for (const s of [a4, letter]) {
    expect(s.width).toBeLessThanOrEqual(196)
    expect(s.height).toBeLessThanOrEqual(262)
  }
  const { container, rerender } = draw()
  const svg = () => container.querySelector('svg') as SVGSVGElement
  expect(Number(svg().getAttribute('width'))).toBe(a4.width)
  expect(Number(svg().getAttribute('height'))).toBe(a4.height)
  rerender(
    <PrintPreview paper="Letter" departments={[lx]} sideOf={() => 'left'} standbyWarn={false} />,
  )
  expect(Number(svg().getAttribute('width'))).toBe(letter.width)
  expect(Number(svg().getAttribute('height'))).toBe(letter.height)
})

test('it is one labelled picture that names the sides, with the caption under it', () => {
  draw()
  expect(
    screen.getByRole('img', { name: 'Preview: LX and TM tags on the left, SND on the right' }),
  ).toBeTruthy()
  expect(screen.getByText('Sides follow the show settings')).toBeTruthy()
})

test('the label covers one side, three departments, and none', () => {
  const { rerender } = draw({ departments: [lx, tm], sideOf: () => 'left' })
  expect(screen.getByRole('img', { name: 'Preview: LX and TM tags on the left' })).toBeTruthy()
  rerender(
    <PrintPreview
      paper="A4"
      departments={[lx, snd, tm]}
      sideOf={() => 'right'}
      standbyWarn={false}
    />,
  )
  expect(
    screen.getByRole('img', { name: 'Preview: LX, SND and TM tags on the right' }),
  ).toBeTruthy()
  rerender(<PrintPreview paper="A4" departments={[]} sideOf={() => 'left'} standbyWarn={false} />)
  expect(screen.getByRole('img', { name: 'Preview: no layers, a clean page' })).toBeTruthy()
})

test('standby and warn add one dashed tag per department, on the same side', () => {
  const { container } = draw({ standbyWarn: true })
  for (const id of ['lx', 'snd', 'tm']) {
    const dashed = container.querySelectorAll(`[data-tag][data-dept="${id}"][data-kind="standby"]`)
    expect(dashed).toHaveLength(1)
    expect(dashed[0]?.getAttribute('data-side')).toBe(sides[id])
    expect(dashed[0]?.querySelector('rect')?.getAttribute('stroke-dasharray')).toBeTruthy()
  }
  const plain = draw({ standbyWarn: false }).container
  expect(plain.querySelectorAll('[data-kind="standby"]')).toHaveLength(0)
})
