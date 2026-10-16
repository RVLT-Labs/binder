import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AnnotationEditor } from './AnnotationEditor'
import { endRebind } from './tools'

type Row = Record<string, unknown>
let row: Row
const session = {
  departments: [
    { id: 'lx', code: 'LX', name: 'Lighting', colour: '#F5A623' },
    { id: 'snd', code: 'SND', name: 'Sound', colour: '#4A90E2' },
  ],
  editable: [
    { kind: 'department', id: 'lx' },
    { kind: 'department', id: 'snd' },
    { kind: 'personal', id: 'u1' },
  ],
  stamps: ['Enter', 'Exit', 'Hold'],
  whyCantEditAnnotation: vi.fn<() => string | null>(() => null),
  layerName: (l: { kind: string; id: string }) =>
    l.kind === 'personal' ? 'Personal' : l.id.toUpperCase(),
  layerColour: (l: { kind: string; id: string }) => (l.kind === 'personal' ? '#6B7280' : '#F5A623'),
  editAnnotation: vi.fn(async () => {}),
  removeAnnotation: vi.fn(async () => {}),
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: () => ({ data: [row] }),
}))
vi.mock('./MarkupSession', () => ({ useMarkupSession: () => session }))

const anchor = { documentId: 'd', documentVersionId: 'v', pageIndex: 0, x: 1, y: 2, status: 'ok' }
function make(over: Row): Row {
  return {
    id: 'a1',
    layer_kind: 'department',
    layer_id: 'lx',
    anchor: JSON.stringify(anchor),
    type: 'rect',
    geometry: JSON.stringify({ w: 10, h: 10 }),
    text: '',
    style: '{}',
    ...over,
  }
}
beforeEach(() => {
  row = make({})
  session.whyCantEditAnnotation.mockReturnValue(null)
})
afterEach(() => {
  vi.clearAllMocks()
  endRebind()
})

const escapeKey = () =>
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

test('a note edits its text on blur and cancels it on Escape', () => {
  row = make({ type: 'note', geometry: '{}', text: 'Cover the gap' })
  const { getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  const text = getByLabelText('Text') as HTMLTextAreaElement
  text.focus()
  fireEvent.change(text, { target: { value: 'Cover the gap early' } })
  fireEvent.blur(text)
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { text: 'Cover the gap early' })

  vi.clearAllMocks()
  text.focus()
  fireEvent.change(text, { target: { value: 'never saved' } })
  const key = escapeKey()
  act(() => {
    text.dispatchEvent(key)
  })
  // Handled in the field: the viewer's Escape-deselects shortcut sees it as already dealt with.
  expect(key.defaultPrevented).toBe(true)
  expect(text.value).toBe('Cover the gap')
  expect(session.editAnnotation).not.toHaveBeenCalled()
})

test('an unchanged note text writes nothing', () => {
  row = make({ type: 'note', geometry: '{}', text: 'Same' })
  const { getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  const text = getByLabelText('Text')
  text.focus()
  fireEvent.blur(text)
  expect(session.editAnnotation).not.toHaveBeenCalled()
})

test('the colour starts as the layer colour and is saved into the style', () => {
  const { getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  const colour = getByLabelText('Colour') as HTMLInputElement
  expect(colour.value).toBe('#f5a623')
  // Dragging in the picker only previews (input events)...
  fireEvent.input(colour, { target: { value: '#ff0000' } })
  expect(session.editAnnotation).not.toHaveBeenCalled()
  // ...and closing it commits (a native change event).
  act(() => {
    colour.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { style: { colour: '#ff0000' } })
})

test('a chosen colour can go back to the layer colour', () => {
  row = make({ style: JSON.stringify({ colour: '#112233', strokeWidth: 2 }) })
  const { getByRole, getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  expect((getByLabelText('Colour') as HTMLInputElement).value).toBe('#112233')
  fireEvent.click(getByRole('button', { name: 'Use layer colour' }))
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { style: { strokeWidth: 2 } })
})

test('stroke width takes 0.5 to 12 and says so otherwise', () => {
  const { getByLabelText, queryByRole } = render(<AnnotationEditor annotationId="a1" />)
  const width = getByLabelText('Stroke width') as HTMLInputElement
  width.focus()
  fireEvent.change(width, { target: { value: '20' } })
  fireEvent.blur(width)
  expect(queryByRole('alert')?.textContent).toBe('Stroke width is 0.5 to 12.')
  expect(session.editAnnotation).not.toHaveBeenCalled()
  width.focus()
  fireEvent.change(width, { target: { value: '3' } })
  fireEvent.blur(width)
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { style: { strokeWidth: 3 } })
  expect(queryByRole('alert')).toBeNull()
})

test('Escape in the stroke width field clears its error and restores the stored width', () => {
  row = make({ style: JSON.stringify({ strokeWidth: 2 }) })
  const { getByLabelText, queryByRole } = render(<AnnotationEditor annotationId="a1" />)
  const width = getByLabelText('Stroke width') as HTMLInputElement
  width.focus()
  fireEvent.change(width, { target: { value: 'wide' } })
  fireEvent.blur(width)
  expect(queryByRole('alert')).not.toBeNull()
  width.focus()
  act(() => {
    width.dispatchEvent(escapeKey())
  })
  expect(width.value).toBe('2')
  expect(queryByRole('alert')).toBeNull()
})

test('font size is for notes and stamps, 6 to 72', () => {
  const rect = render(<AnnotationEditor annotationId="a1" />)
  expect(rect.queryByLabelText('Font size')).toBeNull()
  rect.unmount()
  row = make({ type: 'note', geometry: '{}', text: 'x' })
  const { getByLabelText, queryByLabelText, queryByRole } = render(
    <AnnotationEditor annotationId="a1" />,
  )
  expect(queryByLabelText('Stroke width')).toBeNull()
  const size = getByLabelText('Font size') as HTMLInputElement
  size.focus()
  fireEvent.change(size, { target: { value: '90' } })
  fireEvent.blur(size)
  expect(queryByRole('alert')?.textContent).toBe('Font size is 6 to 72.')
  size.focus()
  fireEvent.change(size, { target: { value: '14' } })
  fireEvent.blur(size)
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { style: { fontSize: 14 } })
})

test('a stamp is chosen from the show’s stamp set', () => {
  row = make({ type: 'stamp', geometry: '{}', text: 'Exit' })
  const { getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  const stamp = getByLabelText('Stamp') as HTMLSelectElement
  expect([...stamp.options].map((o) => o.value)).toEqual(['Enter', 'Exit', 'Hold'])
  expect(stamp.value).toBe('Exit')
  fireEvent.change(stamp, { target: { value: 'Hold' } })
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', { text: 'Hold' })
})

test('a stamp no longer in the set is still shown as it is', () => {
  row = make({ type: 'stamp', geometry: '{}', text: 'Old stamp' })
  const { getByLabelText } = render(<AnnotationEditor annotationId="a1" />)
  const stamp = getByLabelText('Stamp') as HTMLSelectElement
  expect(stamp.value).toBe('Old stamp')
  expect(stamp.options).toHaveLength(4)
})

test('a department annotation offers the department layers only; a personal one offers them all', () => {
  const { getByLabelText, rerender } = render(<AnnotationEditor annotationId="a1" />)
  const layer = getByLabelText('Layer') as HTMLSelectElement
  // Shared markup cannot move onto a personal layer (the server refuses it).
  expect([...layer.options].map((o) => o.value)).toEqual(['department:lx', 'department:snd'])
  expect(layer.value).toBe('department:lx')
  fireEvent.change(layer, { target: { value: 'department:snd' } })
  expect(session.editAnnotation).toHaveBeenCalledWith('a1', {
    layerKind: 'department',
    layerId: 'snd',
  })

  row = make({ layer_kind: 'personal', layer_id: 'u1' })
  rerender(<AnnotationEditor annotationId="a1" />)
  const mine = getByLabelText('Layer') as HTMLSelectElement
  expect([...mine.options].map((o) => o.value)).toEqual([
    'department:lx',
    'department:snd',
    'personal:u1',
  ])
  expect(mine.value).toBe('personal:u1')
  fireEvent.change(mine, { target: { value: 'department:lx' } })
  expect(session.editAnnotation).toHaveBeenLastCalledWith('a1', {
    layerKind: 'department',
    layerId: 'lx',
  })
})

test('a highlight shows its quote and offers "Re-select words"', () => {
  row = make({
    type: 'highlight',
    geometry: '{}',
    anchor: JSON.stringify({
      ...anchor,
      text: { quote: 'to be or not', wordStart: 2, wordEnd: 5 },
    }),
  })
  const { getByRole, container } = render(<AnnotationEditor annotationId="a1" />)
  expect(container.textContent).toContain('to be or not')
  const button = getByRole('button', { name: 'Re-select words' })
  fireEvent.click(button)
  expect(getByRole('button', { name: 'Cancel re-select' })).toBeTruthy()
  fireEvent.click(getByRole('button', { name: 'Cancel re-select' }))
  expect(getByRole('button', { name: 'Re-select words' })).toBeTruthy()
})

test('only a highlight can re-select words', () => {
  const { queryByRole } = render(<AnnotationEditor annotationId="a1" />)
  expect(queryByRole('button', { name: 'Re-select words' })).toBeNull()
})

test('an annotation that cannot be edited is a disabled form with the reason', () => {
  session.whyCantEditAnnotation.mockReturnValue('The LX layer is locked.')
  const { getByText, container } = render(<AnnotationEditor annotationId="a1" />)
  expect(getByText('The LX layer is locked.')).toBeTruthy()
  expect(container.querySelector('fieldset')?.disabled).toBe(true)
})

test('Delete removes it, and Done (phone) is drawn only when the panel supplies it', () => {
  const onDone = vi.fn()
  const { getByRole, queryByRole, rerender } = render(<AnnotationEditor annotationId="a1" />)
  fireEvent.click(getByRole('button', { name: 'Delete annotation' }))
  expect(session.removeAnnotation).toHaveBeenCalledWith('a1')
  expect(queryByRole('button', { name: 'Done' })).toBeNull()
  rerender(<AnnotationEditor annotationId="a1" onDone={onDone} />)
  fireEvent.click(getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledTimes(1)
})
