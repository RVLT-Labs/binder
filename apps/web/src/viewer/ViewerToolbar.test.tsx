import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import { ViewerToolbar } from './ViewerToolbar'

test.each([768, 1440])(
  'R5 actual compact viewer controls reserve 44px targets on coarse %ipx screens',
  (width) => {
    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('matchMedia', () => ({ matches: true, media: '(pointer: coarse)' }))
    const zoom = vi.fn()
    const go = vi.fn()
    render(
      <StatusBar
        page={1}
        pages={20}
        snap
        onSnapChange={vi.fn()}
        activeLayer={{ name: 'Lighting', colour: '#C9811F' }}
      >
        <ViewerToolbar
          size="compact"
          zoom={1}
          onZoomIn={zoom}
          onZoomOut={vi.fn()}
          onFitWidth={vi.fn()}
          pageNumber={1}
          pageCount={20}
          onGoToPage={go}
        />
      </StatusBar>,
    )
    for (const name of ['Zoom out', 'Zoom in', 'Fit width']) {
      const target = screen.getByRole('button', { name })
      const css = getComputedStyle(target)
      expect(Number.parseFloat(css.minWidth)).toBeGreaterThanOrEqual(44)
      expect(Number.parseFloat(css.minHeight)).toBeGreaterThanOrEqual(44)
    }
    const page = screen.getByRole('textbox', { name: 'Go to page' })
    expect(Number.parseFloat(getComputedStyle(page).minHeight)).toBeGreaterThanOrEqual(44)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(zoom).toHaveBeenCalledOnce()
    fireEvent.change(page, { target: { value: '999' } })
    const form = page.closest('form')
    if (!form) throw new Error('The actual page input must belong to its submit form')
    fireEvent.submit(form)
    expect(go).toHaveBeenCalledWith(20)
  },
)
