import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { DialogFooter, DialogHeader, DialogShell } from './dialog-shell'
import { Kbd } from './kbd'
import { Segmented } from './segmented'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

describe('Button', () => {
  it('renders a button with its text', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })
  it('is aria-busy and disabled when loading', () => {
    render(<Button loading>Save</Button>)
    const b = screen.getByRole('button') as HTMLButtonElement
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.disabled).toBe(true)
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ]
  it('is a radiogroup whose options switch aria-checked', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <Segmented value="a" onValueChange={onValueChange} options={options} aria-label="Mode" />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Beta' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }))
    expect(onValueChange).toHaveBeenCalledWith('b')
    rerender(
      <Segmented value="b" onValueChange={onValueChange} options={options} aria-label="Mode" />,
    )
    expect(screen.getByRole('radio', { name: 'Beta' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false')
  })
  it('does not deselect when the selected option is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <Segmented value="a" onValueChange={onValueChange} options={options} aria-label="Mode" />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })
})

describe('DialogShell', () => {
  it('renders a labelled native dialog and forwards the ref', () => {
    const ref = createRef<HTMLDialogElement>()
    render(
      <DialogShell ref={ref} labelledBy="t">
        <DialogHeader id="t">Title</DialogHeader>
        <DialogFooter>
          <Button>OK</Button>
        </DialogFooter>
      </DialogShell>,
    )
    expect(ref.current?.tagName).toBe('DIALOG')
    expect(ref.current?.getAttribute('aria-labelledby')).toBe('t')
    expect(ref.current?.querySelector('#t')?.textContent).toBe('Title')
  })
})

describe('Kbd', () => {
  it('renders a kbd', () => {
    const { container } = render(<Kbd>⌘K</Kbd>)
    expect(container.querySelector('kbd')?.textContent).toBe('⌘K')
  })
})

describe('Tabs', () => {
  it('switches panels via tabs', async () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel one</TabsContent>
        <TabsContent value="two">Panel two</TabsContent>
      </Tabs>,
    )
    expect(screen.getByText('Panel one')).toBeTruthy()
    const two = screen.getByRole('tab', { name: 'Two' })
    // Radix Tabs activates on mousedown.
    fireEvent.mouseDown(two, { button: 0, ctrlKey: false })
    expect(screen.getByText('Panel two')).toBeTruthy()
    expect(screen.queryByText('Panel one')).toBeNull()
  })
})
