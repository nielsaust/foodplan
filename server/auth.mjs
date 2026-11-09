import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { InputError } from './store.mjs'
import { sendMail } from './mail.mjs'

const derive = promisify(scrypt)
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const token = () => randomBytes(32).toString('base64url')
const digest = value => createHash('sha256').update(value).digest('hex')
const validToken = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value)
const minute = 60000
const day = 1440 * minute
const cookieName = 'foodplan_session'
const safeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const neutralMail = { message: 'Als dit adres in aanmerking komt, ontvang je een e-mail.' }

export class AuthError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const requireLogin = session => {
  if (!session) throw new AuthError(401, 'Log in om verder te gaan.')
  return session
}
export function requireOwner(session) {
  if (requireLogin(session).role !== 'owner') throw new AuthError(403, 'Alleen de groepseigenaar kan dit doen.')
}
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@,<>;"\\]+@[^\s@,<>;"\\]+\.[^\s@,<>;"\\]+$/.test(email)) {
    throw new InputError('Vul een geldig e-mailadres in.')
  }
  return email
}
function label(value, max, message) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > max) throw new InputError(message)
  return result
}
function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new InputError('Kies een wachtwoord van 12 tot 128 tekens.')
  }
  return value
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(password, salt, 64, scryptOptions)
  return salt + ':' + hash.toString('hex')
}

export function createAuth(store, mail = sendMail) {
  const { db } = store
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_memberships (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      group_id TEXT NOT NULL REFERENCES group_states(id),
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      person_id TEXT,
      PRIMARY KEY (account_id, group_id),
      UNIQUE (group_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_links (
      hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      email TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `)
  const publicUrl = new URL(process.env.FOODPLAN_PUBLIC_URL || 'http://localhost:8787')
  const bootstrapEmail = process.env.FOODPLAN_LEGACY_OWNER_EMAIL?.trim().toLowerCase()
  const cookie = (value, seconds) => cookieName + '=' + value +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + (publicUrl.protocol === 'https:' ? '; Secure' : '')
  const byEmail = db.prepare('SELECT * FROM accounts WHERE email = ?')
  const findSession = db.prepare(`
    SELECT a.id, a.email, a.name, m.group_id AS groupId, m.role, m.person_id AS personId
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    JOIN group_memberships m ON m.account_id = a.id
    WHERE s.hash = ? AND s.expires > ?
  `)
  const findLink = db.prepare('SELECT * FROM account_links WHERE hash = ? AND expires > ?')
  const removeLink = db.prepare('DELETE FROM account_links WHERE hash = ?')
  const attempts = new Map()

  function throttle(key, maximum) {
    const now = Date.now()
    for (const [id, limit] of attempts) if (limit.until <= now) attempts.delete(id)
    const limit = attempts.get(key) ?? { count: 0, until: now + 15 * minute }
    if (limit.count >= maximum || (!attempts.has(key) && attempts.size >= 10000)) {
      throw new AuthError(429, 'Te veel pogingen. Probeer het later opnieuw.')
    }
    limit.count++
    attempts.set(key, limit)
  }
  function getSessionToken(request) {
    const value = request.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    return validToken(value) ? digest(value) : null
  }
  function session(request) {
    const hash = getSessionToken(request)
    return hash ? findSession.get(hash, Date.now()) : undefined
  }
  function startSession(accountId) {
    const raw = token()
    const now = Date.now()
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now)
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(raw), accountId, now + 30 * day)
    return { 'Set-Cookie': cookie(raw, 30 * day / 1000) }
  }
  function readLink(raw, kinds) {
    const link = validToken(raw) ? findLink.get(digest(raw), Date.now()) : undefined
    if (!link || !kinds.includes(link.kind)) throw new InputError('Deze link is verlopen of al gebruikt.')
    return link
  }
  async function sendLink(kind, email, payload, subject, instruction, lifetime) {
    const raw = token()
    const hash = digest(raw)
    const now = Date.now()
    db.prepare('DELETE FROM account_links WHERE expires <= ?').run(now)
    db.prepare('INSERT INTO account_links VALUES (?, ?, ?, ?, ?)').run(hash, kind, email, JSON.stringify(payload), now + lifetime)
    const url = new URL(publicUrl)
    url.hash = new URLSearchParams({ action: kind === 'reset' ? 'reset' : 'accept', token: raw }).toString()
    try {
      await mail({
        to: email, subject,
        text: instruction + '\n\n' + url.href + '\n\nKun je deze e-mail niet plaatsen? Dan kun je hem negeren.',
        html: '<p>' + safeHtml(instruction) + '</p><p><a href="' + safeHtml(url.href) + '">Open Foodplan</a></p><p>Kun je deze e-mail niet plaatsen? Dan kun je hem negeren.</p>',
      })
    } catch {
      removeLink.run(hash)
      throw new AuthError(503, 'E-mail versturen is nu niet gelukt. Probeer het later opnieuw.')
    }
  }

  async function handle(route, body, request, current) {
    // The reverse proxy may share one socket address across visitors.
    const peer = request.socket.remoteAddress || 'unknown'
    if (route !== 'logout') throttle('network:' + route + ':' + peer, 60)
    switch (route) {
      case 'register': {
        const email = emailAddress(body.email)
        const name = label(body.name, 40, 'Vul je naam in.')
        const group = email === bootstrapEmail ? '' : label(body.group, 80, 'Vul een groepsnaam in.')
        throttle('register:' + email, 4)
        if (!byEmail.get(email)) {
          await sendLink('register', email, { name, group }, 'Bevestig je Foodplan-account',
            'Bevestig je e-mailadres en kies een wachtwoord.', day)
        }
        return neutralMail
      }
      case 'invite': {
        requireOwner(current)
        const email = emailAddress(body.email)
        throttle('owner:' + current.id, 15)
        throttle('invite:' + email, 4)
        if (byEmail.get(email)) throw new InputError('Dit e-mailadres heeft al een Foodplan-account.')
        const { state } = store.read(current.groupId)
        const personId = body.personId || null
        const person = state.people.find(item => item.id === personId)
        if (personId && (!person || db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND person_id = ?').get(current.groupId, personId))) {
          throw new InputError('Deze huisgenoot is niet beschikbaar om te koppelen.')
        }
        await sendLink('invite', email, { groupId: current.groupId, personId }, 'Uitnodiging voor Foodplan',
          'Je bent uitgenodigd voor de groep ' + state.household.name + '.', 7 * day)
        return { message: 'Uitnodiging verstuurd.' }
      }
      case 'accept': {
        const link = readLink(body.token, ['register', 'invite'])
        const password = await passwordHash(passwordInput(body.password))
        return store.transaction(() => {
          readLink(body.token, ['register', 'invite'])
          if (byEmail.get(link.email)) throw new InputError('Dit e-mailadres heeft al een account. Log in om verder te gaan.')
          const data = JSON.parse(link.payload)
          const claim = link.kind === 'register' && bootstrapEmail && link.email === bootstrapEmail &&
            !db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ?').get(store.legacyGroupId)
          if (link.kind === 'register' && !claim && !data.group) {
            throw new InputError('Deze groep is al geclaimd. Vraag de eigenaar om een uitnodiging.')
          }
          const groupId = claim ? store.legacyGroupId : data.groupId ?? randomUUID()
          if (!claim && link.kind === 'register') store.createGroup(groupId, data.group)
          const { state } = store.read(groupId)
          const person = state.people.find(item => item.id === data.personId)
          if (data.personId && (!person || db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND person_id = ?').get(groupId, data.personId))) {
            throw new InputError('Deze huisgenoot is niet beschikbaar. Vraag een nieuwe uitnodiging.')
          }
          const name = data.name || person?.name || label(body.name, 40, 'Vul je naam in.')
          const matching = claim && state.people.find(item => item.name.toLowerCase() === name.toLowerCase())
          const personId = person?.id ?? (matching ? matching.id : randomUUID())
          if (!person && !matching) store.addGroupPerson(groupId, { id: personId, name, factor: 1 })
          const id = randomUUID()
          db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, link.email, name, password)
          db.prepare('INSERT INTO group_memberships VALUES (?, ?, ?, ?)').run(id, groupId, link.kind === 'invite' ? 'member' : 'owner', personId)
          removeLink.run(link.hash)
          return { headers: startSession(id) }
        })
      }
      case 'login': {
        const email = emailAddress(body.email)
        throttle('login:' + email, 8)
        const account = byEmail.get(email)
        const [salt, expected] = (account?.password ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(':')
        const hash = await derive(passwordInput(body.password), salt, 64, scryptOptions)
        if (!timingSafeEqual(hash, Buffer.from(expected, 'hex')) || !account || byEmail.get(email)?.password !== account.password) {
          throw new AuthError(401, 'E-mailadres of wachtwoord klopt niet.')
        }
        return { headers: startSession(account.id) }
      }
      case 'forgot': {
        const email = emailAddress(body.email)
        throttle('forgot:' + email, 4)
        if (byEmail.get(email)) {
          void sendLink('reset', email, {}, 'Nieuw wachtwoord voor Foodplan',
            'Kies binnen een uur een nieuw wachtwoord voor je account.', 60 * minute)
            .catch(() => console.error('Een wachtwoordherstelmail kon niet worden verstuurd.'))
        }
        return neutralMail
      }
      case 'reset': {
        const link = readLink(body.token, ['reset'])
        const password = await passwordHash(passwordInput(body.password))
        store.transaction(() => {
          readLink(body.token, ['reset'])
          const account = byEmail.get(link.email)
          if (!account) throw new InputError('Dit account bestaat niet meer.')
          db.prepare('UPDATE accounts SET password = ? WHERE id = ?').run(password, account.id)
          db.prepare('DELETE FROM account_links WHERE kind = ? AND email = ?').run('reset', link.email)
          db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id)
        })
        return { message: 'Je wachtwoord is gewijzigd. Je kunt nu inloggen.', headers: { 'Set-Cookie': cookie('', 0) } }
      }
      case 'logout': {
        const hash = getSessionToken(request)
        if (hash) db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash)
        return { headers: { 'Set-Cookie': cookie('', 0) } }
      }
      default: throw new AuthError(404, 'Pagina niet gevonden.')
    }
  }
  return { session, handle }
}
