import nodemailer from 'nodemailer'
import type { Config } from '../config'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export type SendMail = (message: MailMessage) => Promise<void>

/**
 * Sends through SMTP when SMTP_URL is set. Without it, development logs the whole message so sign-in
 * links are visible; production logs only that a message was dropped, never its body (a sign-in link
 * is a credential).
 */
export function createMailer(config: Pick<Config, 'SMTP_URL' | 'NODE_ENV'>): SendMail {
  if (!config.SMTP_URL) {
    if (config.NODE_ENV === 'production') {
      return async ({ subject }) => {
        console.warn(`[mail] not sent, SMTP is not configured: subject=${subject}`)
      }
    }
    return async ({ to, subject, text }) => {
      console.info(`[mail] to=${to} subject=${subject}\n${text}`)
    }
  }
  const transport = nodemailer.createTransport(config.SMTP_URL)
  return async ({ to, subject, text }) => {
    await transport.sendMail({ to, subject, text })
  }
}
