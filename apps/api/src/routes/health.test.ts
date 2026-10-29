import { expect, test } from 'vitest'
import { health } from './health'

test('public capabilities advertises the validated ink annotation format', async () => {
  const response = await health.request('/capabilities')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ink: true })
})
