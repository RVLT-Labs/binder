import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from './badge'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { DialogFooter, DialogFooterBar, DialogHeader, DialogShell } from './dialog-shell'
import { Input } from './input'
import { Kbd } from './kbd'
import { Label } from './label'
import { Segmented } from './segmented'
import { Switch } from './switch'
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

describe('Button looks (mockup _head.html .btn)', () => {
  const cls = (props: Parameters<typeof Button>[0]) => {
    const { container, unmount } = render(<Button {...props}>X</Button>)
    const name = container.querySelector('button')?.className ?? ''
    unmount()
    return name
  }

  it('is never a pill: radius 10 at 30 px, 8 at 26 px, 12 on phone', () => {
    const def = cls({})
    expect(def).not.toContain('rounded-full')
    expect(def).toContain('rounded-[12px]')
    expect(def).toContain('md:rounded-[10px]')
    expect(cls({ size: 'sm' })).toContain('md:rounded-[8px]')
  })

  it('is 30 / 26 px at 768 and up, 44 px on a phone, with a 44 px hit area on a tablet', () => {
    const def = cls({})
    expect(def).toContain('h-11')
    expect(def).toContain('md:h-[30px]')
    expect(def).toContain('md:px-3')
    expect(def).toContain('md:text-[13px]')
    expect(def).toContain('md:after:-inset-y-[7px]')
    const sm = cls({ size: 'sm' })
    expect(sm).toContain('h-11')
    expect(sm).toContain('md:h-[26px]')
    expect(sm).toContain('md:px-[9px]')
    expect(sm).toContain('md:text-[12px]')
    expect(sm).toContain('md:after:-inset-y-[9px]')
    const lg = cls({ size: 'lg' })
    expect(lg).toContain('h-12')
    expect(lg).toContain('text-[16px]')
    expect(lg).toContain('md:h-10')
    expect(lg).toContain('md:text-[14px]')
  })

  it('primary is red with a 2px red border and the sticker shadow', () => {
    const c = cls({ variant: 'primary' })
    expect(c).toContain('bg-red')
    expect(c).toContain('border-red')
    expect(c).toContain('shadow-sticker')
    expect(c).toContain('active:shadow-lit')
  })

  it('the outlined button is card-filled with a 2px outline and no ink inversion on hover', () => {
    const c = cls({ variant: 'line' })
    expect(c).toContain('border-2')
    expect(c).toContain('border-border')
    expect(c).toContain('bg-card')
    expect(c).not.toContain('hover:bg-ink')
  })

  it('ghost is ink-2 and never goes red on hover', () => {
    const c = cls({ variant: 'ghost' })
    expect(c).toContain('text-ink-2')
    expect(c).not.toContain('hover:text-red')
    expect(c).toContain('border-transparent')
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

describe('form controls and chrome (mockup _head.html)', () => {
  const first = (ui: React.ReactElement) => {
    const { container, unmount } = render(ui)
    const el = container.firstElementChild as HTMLElement
    const html = { className: el.className, el }
    unmount()
    return html
  }

  it('Input: paper ground, 30 px / radius 9 / 13 px from 768 up, 48 px / radius 12 / 16 px on a phone', () => {
    const c = first(<Input />).className
    for (const token of [
      'bg-paper',
      'h-12',
      'rounded-[12px]',
      'text-[16px]',
      'md:h-[30px]',
      'md:rounded-[9px]',
      'md:text-[13px]',
      'md:px-[9px]',
    ]) {
      expect(c).toContain(token)
    }
    const lg = first(<Input inputSize="lg" />).className
    expect(lg).toContain('md:h-[38px]')
    expect(lg).toContain('md:text-[14px]')
  })

  it('Label: 11 px / 600 ink-2', () => {
    const c = first(<Label>Email</Label>).className
    expect(c).toContain('text-[11px]')
    expect(c).toContain('font-semibold')
    expect(c).toContain('text-ink-2')
  })

  it('Badge: 20 px high pill, 18 px for the inline flag, neutral is the grey `rep` pill', () => {
    const c = first(<Badge>Archived</Badge>).className
    for (const token of ['h-5', 'px-2', 'gap-[5px]', 'font-semibold', 'text-rep', 'bg-rep-soft']) {
      expect(c).toContain(token)
    }
    expect(first(<Badge size="sm">4</Badge>).className).toContain('h-[18px]')
  })

  it('Segmented: a 2px outline, no track fill, the chosen item is elev with no shadow', () => {
    const { container } = render(
      <Segmented
        value="a"
        onValueChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        aria-label="x"
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('border-2')
    expect(root.className).toContain('md:rounded-[9px]')
    expect(root.className).not.toContain('bg-paper-2')
    expect(root.className).not.toContain('p-0.5')
    const item = screen.getByRole('radio', { name: 'A' })
    expect(item.className).toContain('md:text-[12px]')
    expect(item.className).toContain('data-[state=on]:bg-elev')
    expect(item.className).not.toContain('shadow-card')
  })

  it('Checkbox: 16 px, radius 5, paper fill, ink when checked (never red)', () => {
    const c = first(<Checkbox aria-label="c" />).className
    for (const token of ['size-4', 'rounded-[5px]', 'bg-paper', 'data-[state=checked]:bg-ink']) {
      expect(c).toContain(token)
    }
    expect(c).not.toContain('bg-red')
  })

  it('Switch: 52 x 32, green when on (never red)', () => {
    const c = first(<Switch aria-label="s" />).className
    for (const token of ['h-8', 'w-[52px]', 'data-[state=checked]:bg-ok']) {
      expect(c).toContain(token)
    }
    expect(c).not.toContain('bg-red')
  })

  it('Dialog: the mockup shadow, a rule above the footer, and a full-bleed footer bar', () => {
    const shell = first(
      <DialogShell labelledBy="t">
        <DialogHeader id="t">T</DialogHeader>
      </DialogShell>,
    ).className
    expect(shell).toContain('shadow-dialog')
    expect(first(<DialogFooter />).className).not.toContain('border-t')
    expect(first(<DialogFooter divided />).className).toContain('border-t')
    const bar = first(<DialogFooterBar />).className
    expect(bar).toContain('bg-paper-2')
    expect(bar).toContain('border-t')
  })
})
