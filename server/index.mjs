import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { today } from '../domain/planning.ts'
import { receiveDeployWebhook } from './deploy-webhook.mjs'
import { AuthError, createAuth, requireOwner } from './auth.mjs'
import { InputError, openStore } from './store.mjs'

const store = openStore(process.env.DATABASE_PATH || 'data/aan-tafel.sqlite')
const auth = createAuth(store)
const root = resolve('dist')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const json = (response, status, data, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(data))
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/api/deploy' && request.method === 'POST') {
      return await receiveDeployWebhook(request, (status, data) => json(response, status, data))
    }
    if (path === '/api/auth/session' && request.method === 'GET') {
      return json(response, 200, { account: auth.session(request) ?? null })
    }
    const authRoute = path.startsWith('/api/auth/') ? path.slice('/api/auth/'.length) : ''
    const restore = path === '/api/backup'
    const groupRoute = path === '/api/state' || restore
    const account = groupRoute || authRoute ? auth.session(request) : undefined
    if (groupRoute && !account) throw new AuthError(401, 'Log in om verder te gaan.')
    if (restore) requireOwner(account)
    if (groupRoute && request.method === 'GET') {
      const snapshot = store.read(account.groupId)
      if (!restore) return json(response, 200, snapshot)
      return json(response, 200, { format: 'aan-tafel', version: 1, state: snapshot.state }, {
        'Content-Disposition': `attachment; filename="aan-tafel-${today()}.json"`,
      })
    }
    if ((groupRoute || authRoute) && request.method === 'POST') {
      if (request.headers['content-type'] !== 'application/json' || request.headers['sec-fetch-site'] === 'cross-site') {
        return json(response, 415, { error: 'Verstuur gegevens als JSON vanaf deze app.' })
      }
      const limit = restore ? 10 * 1024 * 1024 : authRoute ? 8192 : 65536
      let body = ''
      for await (const part of request.setEncoding('utf8')) {
        body += part
        if (body.length > limit) return json(response, 413, { error: 'Dit verzoek is te groot.' })
      }
      let action
      try { action = JSON.parse(body) } catch { throw new InputError('Ongeldige invoer.') }
      if (authRoute) {
        if (!action || typeof action !== 'object' || Array.isArray(action)) throw new InputError('Ongeldige invoer.')
        const { headers, ...result } = await auth.handle(authRoute, action, request, account)
        return json(response, 200, result, headers)
      }
      if (action?.type === 'clearDatabase') requireOwner(account)
      return json(response, 200, store.write(account.groupId, action, restore))
    }

    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path))
    if (request.method !== 'GET' || !file.startsWith(root + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      return json(response, 404, { error: 'Pagina niet gevonden.' })
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' })
    const stream = createReadStream(file)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  } catch (error) {
    const status = error instanceof AuthError ? error.status : error instanceof InputError ? 400 : 500
    if (status === 500) console.error(error)
    json(response, status, {
      error: status === 500 ? 'Opslaan of laden is niet gelukt.' : error.message,
    })
  }
})

server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  console.log('Aan tafel luistert op poort ' + server.address().port)
})
