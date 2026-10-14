import nodemailer from 'nodemailer'
import type { Config } from '../config'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export type SendMail = (message: MailMessage) => Promise<void>

/** Sends through SMTP when SMTP_URL is set; otherwise logs the message so dev sign-in links are visible. */
export function createMailer(config: Pick<Config, 'SMTP_URL'>): SendMail {
  if (!config.SMTP_URL) {
    return async ({ to, subject, text }) => {
      console.info(`[mail] to=${to} subject=${subject}\n${text}`)
    }
  }
  const transport = nodemailer.createTransport(config.SMTP_URL)
  return async ({ to, subject, text }) => {
    await transport.sendMail({ to, subject, text })
  }
}
