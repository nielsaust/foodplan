import { createHmac, timingSafeEqual } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

export async function receiveDeployWebhook(request, json) {
  const { DEPLOY_WEBHOOK_SECRET: secret, DEPLOY_SIGNAL_FILE: signal } = process.env
  if (!secret || !signal) return json(404, { error: 'Webhook uitgeschakeld.' })

  const signature = request.headers['x-hub-signature-256']
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    return json(401, { error: 'Ongeldige handtekening.' })
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 10 * 1024 * 1024) return json(413, { error: 'Webhook te groot.' })
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)
  const expected = createHmac('sha256', secret).update(body).digest()
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
    return json(401, { error: 'Ongeldige handtekening.' })
  }

  let event
  try {
    event = JSON.parse(body)
  } catch {
    return json(400, { error: 'Ongeldige JSON.' })
  }

  if (request.headers['x-github-event'] !== 'push' || event?.repository?.full_name !== 'nielsaust/foodplan' ||
      event.ref !== 'refs/heads/main' || event.deleted !== false) {
    return json(200, { queued: false })
  }

  try {
    await writeFile(signal, '', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return json(202, { queued: true })
}
