import nodemailer from 'nodemailer'

export async function sendMail({ to, subject, text, html }) {
  if (process.env.FOODPLAN_LOCAL_MAIL === 'log') {
    const url = new URL(process.env.FOODPLAN_PUBLIC_URL || 'http://localhost:8787')
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Lokale testmail vereist een loopbackadres.')
    }
    console.info('[Foodplan testmail] %s\n%s', subject, text)
    return
  }

  const {
    CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token,
    EMAIL_FROM_ADDRESS: address, EMAIL_FROM_NAME: name,
  } = process.env
  if (!token || !address || !name) throw new Error('Mail is niet geconfigureerd.')
  const from = { address, name }

  if (account) {
    const response = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account) + '/email/sending/send',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from, subject, text, html }),
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
      },
    )
    const result = await response.json()
    if (!response.ok || result.success !== true) {
      throw new Error('Cloudflare heeft de mail niet geaccepteerd (HTTP ' + response.status + ').')
    }
    return
  }

  const smtp = nodemailer.createTransport({
    host: 'smtp.mx.cloudflare.net', port: 465, secure: true,
    auth: { user: 'api_token', pass: token },
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 12000,
  })
  try {
    await smtp.sendMail({ to: { address: to, name: '' }, from, subject, text, html })
  } finally {
    smtp.close()
  }
}
