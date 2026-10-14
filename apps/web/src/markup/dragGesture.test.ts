import { afterEach, expect, test, vi } from 'vitest'
import { startPointerDrag } from './dragGesture'

function fire(type: string, pointerId: number, x: number, y: number, button = 0) {
  // jsdom has no PointerEvent: a MouseEvent with the pointer's id is what the handlers read.
  const ev = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true })
  Object.defineProperty(ev, 'pointerId', { value: pointerId })
  window.dispatchEvent(ev)
}

const stops: Array<() => void> = []
function drag(pointerId = 1) {
  const calls = { move: vi.fn(), drop: vi.fn(), stop: vi.fn() }
  stops.push(
    startPointerDrag({
      pointerId,
      start: { x: 100, y: 100 },
      onMove: calls.move,
      onDrop: calls.drop,
      onStop: calls.stop,
    }),
  )
  return calls
}
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

test('moves under the threshold are ignored; past it the drag reports every move', () => {
  const d = drag()
  fire('pointermove', 1, 101, 101)
  expect(d.move).not.toHaveBeenCalled()
  fire('pointermove', 1, 110, 100)
  fire('pointermove', 1, 120, 100)
  expect(d.move).toHaveBeenCalledTimes(2)
})

test('a release after a real drag drops once and stops', () => {
  const d = drag()
  fire('pointermove', 1, 130, 100)
  fire('pointerup', 1, 140, 105)
  expect(d.drop).toHaveBeenCalledOnce()
  expect(d.stop).toHaveBeenCalledOnce()
  fire('pointermove', 1, 200, 100)
  fire('pointerup', 1, 200, 100)
  expect(d.move).toHaveBeenCalledTimes(1)
  expect(d.drop).toHaveBeenCalledOnce()
})

test('a release that never passed the threshold stops without dropping', () => {
  const d = drag()
  fire('pointerup', 1, 101, 100)
  expect(d.drop).not.toHaveBeenCalled()
  expect(d.stop).toHaveBeenCalledOnce()
})

test('a cancel stops without dropping', () => {
  const d = drag()
  fire('pointermove', 1, 150, 100)
  fire('pointercancel', 1, 150, 100)
  expect(d.drop).not.toHaveBeenCalled()
  expect(d.stop).toHaveBeenCalledOnce()
})

test("another pointer's events neither move nor end the drag", () => {
  const d = drag(1)
  // A second finger, or a second device, moves and lifts.
  fire('pointermove', 2, 300, 300)
  fire('pointerup', 2, 300, 300)
  fire('pointercancel', 2, 300, 300)
  expect(d.move).not.toHaveBeenCalled()
  expect(d.drop).not.toHaveBeenCalled()
  expect(d.stop).not.toHaveBeenCalled()
  // The drag's own pointer still works.
  fire('pointermove', 1, 150, 100)
  fire('pointerup', 1, 150, 100)
  expect(d.move).toHaveBeenCalledOnce()
  expect(d.drop).toHaveBeenCalledOnce()
})

test('stop() ends the drag at once and is safe to call twice', () => {
  const d = drag()
  const stop = stops[0] as () => void
  stop()
  stop()
  expect(d.stop).toHaveBeenCalledOnce()
  fire('pointermove', 1, 150, 100)
  expect(d.move).not.toHaveBeenCalled()
})
