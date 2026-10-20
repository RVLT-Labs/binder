import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Button } from './button'
import { Input } from './input'
import { Segmented } from './segmented'
import { Tabs, TabsList, TabsTrigger } from './tabs'

// Structural guards supplement the real two-axis elementFromPoint browser probes.
test('B09 Button reserves its full target in layout and draws a separate compact face', () => {
  render(<Button size="sm">A</Button>)
  const button = screen.getByRole('button', { name: 'A' })
  expect(button.className).toContain('min-h-11')
  expect(button.className).toContain('min-w-11')
  expect(button.className).toContain('md:before:h-[26px]')
  expect(button.className).not.toContain('after:-inset')
})

test('B09 fields, segmented items and tabs reserve 44px in both axes at every width', () => {
  render(
    <>
      <Input aria-label="Number" />
      <Segmented
        value="a"
        onValueChange={() => {}}
        aria-label="Mode"
        options={[{ value: 'a', label: 'Alpha' }]}
      />
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
        </TabsList>
      </Tabs>
    </>,
  )
  for (const el of [
    screen.getByRole('textbox'),
    screen.getByRole('radio'),
    screen.getByRole('tab'),
  ]) {
    expect(el.className).toContain('min-h-11')
    expect(el.className).toContain('min-w-11')
  }
})

test('B09 Sheet close has a 44px target with reserved header space', async () => {
  const { Sheet, SheetContent, SheetTitle, SheetDescription } = await import('./sheet')
  render(
    <Sheet defaultOpen>
      <SheetContent>
        <SheetTitle>Layers</SheetTitle>
        <SheetDescription>Choose a layer</SheetDescription>
      </SheetContent>
    </Sheet>,
  )
  const close = screen.getByRole('button', { name: 'Close' })
  expect(close.className).toContain('size-11')
  expect(close.parentElement?.className).toContain('pt-20')
})

test('B09 Calling page turns and colour triggers cannot shrink below their reserved target', async () => {
  const { CallingStrip } = await import('../../calling/CallingStrip')
  const { ColourField } = await import('../../settings/ColourField')
  render(
    <>
      <CallingStrip
        page={2}
        pages={4}
        next={null}
        onPrev={() => {}}
        onNext={() => {}}
        onGoTo={() => {}}
        onExit={() => {}}
      />
      <ColourField
        label="New colour"
        value="#C9811F"
        onChange={() => {}}
        className="md:h-[30px] md:w-[34px]"
      />
    </>,
  )
  expect(screen.getByRole('button', { name: 'Next page' }).className).not.toContain(
    'md:min-w-[26px]',
  )
  expect(screen.getByRole('button', { name: 'New colour' }).className).toContain('min-h-11')
  expect(screen.getByRole('button', { name: 'New colour' }).className).toContain('min-w-11')
})

test('B09 Checkbox and Switch reserve their hit areas in layout instead of overlapping neighbours', async () => {
  const { Checkbox } = await import('./checkbox')
  const { Switch } = await import('./switch')
  render(
    <>
      <Checkbox aria-label="Include cue notes" />
      <Switch aria-label="Keep this show" />
    </>,
  )
  expect(screen.getByRole('checkbox').className.split(' ')).toContain('size-11')
  expect(screen.getByRole('switch').className.split(' ')).toContain('h-11')
  expect(screen.getByRole('checkbox').className).not.toContain('after:-inset')
  expect(screen.getByRole('switch').className).not.toContain('after:-inset')
})

test('B09 native select fields reserve the same tablet target as Input', async () => {
  const { SelectField } = await import('../../panel/fields')
  render(
    <SelectField aria-label="Layer">
      <option>Lighting</option>
    </SelectField>,
  )
  expect(screen.getByRole('combobox').className).toContain('min-h-11')
  expect(screen.getByRole('combobox').className).toContain('min-w-11')
})

test('B09 compact faces retain caller-specific fills in document controls', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const source = readFileSync(
    join(import.meta.dirname, '../../viewer/DocumentControls.tsx'),
    'utf8',
  )
  expect(source).toContain('hover:before:bg-elev')
  expect(source).toContain('aria-pressed:before:bg-card')
})
