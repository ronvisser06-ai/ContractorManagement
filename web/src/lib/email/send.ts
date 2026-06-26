import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.RESEND_FROM ?? 'onboarding@resend.dev'

export type SendResult = { sent: true } | { sent: false }

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
  if (!resend) return { sent: false }
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  })
  if (error) throw new Error(error.message)
  return { sent: true }
}

export function companyInviteEmail(link: string): { html: string; text: string } {
  return {
    html: `<p>You've been invited to register your company on the Contractor Orientation platform.</p>
<p><a href="${link}">Accept invitation</a></p>
<p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`,
    text: `You've been invited to register your company on the Contractor Orientation platform.\n\nAccept: ${link}\n\nThis link expires in 7 days.`,
  }
}

export function workerInviteEmail(link: string): { html: string; text: string } {
  return {
    html: `<p>Your company has invited you to create your contractor account on the Contractor Orientation platform.</p>
<p><a href="${link}">Accept invitation</a></p>
<p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`,
    text: `Your company has invited you to create your contractor account.\n\nAccept: ${link}\n\nThis link expires in 7 days.`,
  }
}

export function emailVerificationEmail(link: string): { html: string; text: string } {
  return {
    html: `<p>Click the link below to verify your email address and add it to your account.</p>
<p><a href="${link}">Verify email</a></p>
<p>This link expires in 24 hours. If you didn't request this, you can ignore it.</p>`,
    text: `Verify your email address:\n\n${link}\n\nThis link expires in 24 hours.`,
  }
}
