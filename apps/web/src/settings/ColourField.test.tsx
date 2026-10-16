import { DEPARTMENT_COLOUR_PRESETS } from '@binder/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ColourField } from './ColourField'

function open(onChange = vi.fn(), value = '#C9811F') {
  render(<ColourField label="LX colour" value={value} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'LX colour' }))
  return { onChange, input: screen.getByLabelText('Custom colour') as HTMLInputElement }
}

const RED_MESSAGE = "Red is kept for Binder's own alerts. Pick another colour."

describe('ColourField', () => {
  it('offers the department presets as radio buttons, the current one checked', () => {
    open()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(DEPARTMENT_COLOUR_PRESETS.length)
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1)
    expect((screen.getByRole('radio', { name: 'LX preset' }) as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it('picks a preset', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('radio', { name: 'SND preset' }))
    expect(onChange).toHaveBeenCalledWith('#2F6BD6')
  })

  it('refuses a colour close to red with the alert message and does not call onChange', () => {
    const { onChange, input } = open()
    fireEvent.change(input, { target: { value: '#E0363D' } })
    expect(screen.getByRole('alert').textContent).toBe(RED_MESSAGE)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts a custom colour and upper-cases it', () => {
    const { onChange, input } = open()
    fireEvent.change(input, { target: { value: '#2f6bd6' } })
    expect(onChange).toHaveBeenCalledWith('#2F6BD6')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['2F6BD6', '#ZZZZZZ', '#2F6BD6FF'])(
    'says plainly that %s is not a colour, before the red check, and does not call onChange',
    (bad) => {
      const { onChange, input } = open()
      fireEvent.change(input, { target: { value: bad } })
      expect(screen.getByRole('alert').textContent).toBe('Use a colour like #2F6BD6.')
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('waits while a hex colour is still being typed, then complains on leaving the field', () => {
    const { onChange, input } = open()
    fireEvent.change(input, { target: { value: '#abc' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toBe('Use a colour like #2F6BD6.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears the message once the colour is fine', () => {
    const { input } = open()
    fireEvent.change(input, { target: { value: '#E0363D' } })
    fireEvent.change(input, { target: { value: '#1C8B83' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
