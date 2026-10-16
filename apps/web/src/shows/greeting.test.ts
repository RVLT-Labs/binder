import { describe, expect, it } from 'vitest'
import { firstName, greeting } from './greeting'

describe('greeting', () => {
  it.each([
    [0, 'Good evening'],
    [4, 'Good evening'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
    [23, 'Good evening'],
  ])('at %i:00 it says %s', (hour, expected) => {
    expect(greeting(new Date(2026, 9, 16, hour, 30), 'Jayden')).toBe(`${expected}, Jayden.`)
  })
})

describe('firstName', () => {
  it('takes the first word of the name', () => {
    expect(firstName('Jayden Nawotka', 'jayden@qubered.com')).toBe('Jayden')
  })
  it('falls back to the part of the email before the @', () => {
    expect(firstName('', 'oli.k@example.test')).toBe('oli.k')
    expect(firstName('   ', 'oli@example.test')).toBe('oli')
  })
  it('does not greet an email address typed as the name', () => {
    expect(firstName('oli@example.test', 'oli@example.test')).toBe('oli')
  })
  it('is empty when nobody is known', () => {
    expect(firstName('', '')).toBe('')
  })
})
