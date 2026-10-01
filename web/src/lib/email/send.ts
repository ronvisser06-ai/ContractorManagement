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
  if (error) {
    // Never crash the caller: the invite/verification row already exists, so
    // callers fall back to showing the link on screen. Common cause: the test
    // sender onboarding@resend.dev only delivers to the Resend account owner —
    // a verified sending domain (RESEND_FROM) is needed for real recipients.
    console.error(`[email] Resend refused "${opts.subject}" to ${opts.to}: ${error.message}`)
    return { sent: false }
  }
  return { sent: true }
}

export function companyAdminInviteEmail(opts: {
  link: string
  companyName: string
  orgName: string
}): { html: string; text: string } {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
  return {
    html: `<p>${esc(opts.orgName)} has set up <strong>${esc(opts.companyName)}</strong> on the Contractor Orientation platform and nominated you as its administrator.</p>
<p><a href="${opts.link}">Accept and open ${esc(opts.companyName)}</a></p>
<p>This link expires in 7 days and only works for this email address. If you weren't expecting this, you can ignore it.</p>`,
    text: `${opts.orgName} has set up ${opts.companyName} on the Contractor Orientation platform and nominated you as its administrator.\n\nAccept: ${opts.link}\n\nThis link expires in 7 days and only works for this email address.`,
  }
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
