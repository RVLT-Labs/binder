import { describe, expect, test, vi } from 'vitest'
import { createMailer, type MailMessage } from '../src/auth/mailer'
import { createTestApp, createTestUser, testConfig } from './helpers'

// I3: without SMTP in production a magic link could only reach the container log, where it is a
// live five-minute credential. So production without SMTP_URL has no magic-link sign-in at all.

const requestLink = (app: Awaited<ReturnType<typeof createTestApp>>['app'], email: string) =>
  app.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })

async function health(app: Awaited<ReturnType<typeof createTestApp>>['app']) {
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  return res.json()
}

describe('magic-link capability', () => {
  test('production without SMTP_URL: no magic-link endpoint, no mail, health says disabled', async () => {
    const mails: MailMessage[] = []
    const { app, deps } = await createTestApp(
      { config: testConfig({ NODE_ENV: 'production' }) },
      async (m) => void mails.push(m),
    )
    await createTestUser(app, deps, { email: 'p@x.test', name: 'P', password: 'password123' })
    const res = await requestLink(app, 'p@x.test')
    expect(res.status).toBe(404)
    expect(mails).toHaveLength(0)
    expect(await health(app)).toEqual({ ok: true, magicLink: false })
  })

  test('production with SMTP_URL: magic links are sent and health says enabled', async () => {
    const mails: MailMessage[] = []
    const { app, deps } = await createTestApp(
      { config: testConfig({ NODE_ENV: 'production', SMTP_URL: 'smtp://mail.test:587' }) },
      async (m) => void mails.push(m),
    )
    await createTestUser(app, deps, { email: 's@x.test', name: 'S', password: 'password123' })
    expect((await requestLink(app, 's@x.test')).status).toBe(200)
    expect(mails).toHaveLength(1)
    expect(await health(app)).toEqual({ ok: true, magicLink: true })
  })

  test('development without SMTP_URL keeps magic links (logged by the dev mailer)', async () => {
    const { app } = await createTestApp()
    expect(await health(app)).toEqual({ ok: true, magicLink: true })
  })
})

describe('log mailer', () => {
  const message = {
    to: 'a@x.test',
    subject: 'Your Binder sign-in link',
    text: 'Sign in to Binder: https://binder.test/api/auth/magic-link/verify?token=secret',
  }

  test('outside production it prints the message, link included', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await createMailer({ NODE_ENV: 'development' })(message)
    expect(info.mock.calls.flat().join(' ')).toContain('token=secret')
  })

  test('in production it never prints the body', async () => {
    const logged = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]
    await createMailer({ NODE_ENV: 'production' })(message)
    const out = logged.flatMap((s) => s.mock.calls.flat()).join(' ')
    expect(out).not.toContain('token=secret')
    expect(out).not.toContain('https://')
    expect(out).toContain('SMTP')
  })
})
