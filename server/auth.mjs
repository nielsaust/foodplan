import { createEmailTemplates } from './email-templates.mjs'
import { dietTags } from '../domain/catalog.ts'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { InputError } from './store.mjs'
import { createModeration } from './moderation.mjs'
import { sendMail } from './mail.mjs'

const derive = promisify(scrypt)
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const token = () => randomBytes(32).toString('base64url')
const digest = value => createHash('sha256').update(value).digest('hex')
const validToken = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value)
const minute = 60000
const day = 1440 * minute
const cookieName = 'foodplan_session'
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
export function requireSuperuser(session) {
  if (!requireLogin(session).superuser) throw new AuthError(403, 'Alleen superusers hebben toegang.')
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
  const emailTemplates = createEmailTemplates(db)
  const moderation = createModeration(store)
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
    CREATE TABLE IF NOT EXISTS superusers (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS administrative_blocks (
      kind TEXT NOT NULL CHECK (kind IN ('account', 'group')),
      id TEXT NOT NULL,
      PRIMARY KEY (kind, id)
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
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'created')) {
    db.exec('ALTER TABLE accounts ADD COLUMN created INTEGER')
  }
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'unit_system')) {
    db.exec("ALTER TABLE accounts ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'metric'")
  }
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'diet_preferences')) {
    db.exec("ALTER TABLE accounts ADD COLUMN diet_preferences TEXT NOT NULL DEFAULT '[]'")
  }
  const rootEmail = (process.env.FOODPLAN_SUPERUSER_EMAIL?.trim() || process.env.FOODPLAN_LEGACY_OWNER_EMAIL?.trim() || '').toLowerCase()
  const publicUrl = new URL(process.env.FOODPLAN_PUBLIC_URL || 'http://localhost:8787')
  const bootstrapEmail = process.env.FOODPLAN_LEGACY_OWNER_EMAIL?.trim().toLowerCase()
  const cookie = (value, seconds) => cookieName + '=' + value +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + (publicUrl.protocol === 'https:' ? '; Secure' : '')
  const byEmail = db.prepare('SELECT * FROM accounts WHERE email = ?')
  const findSession = db.prepare(`
    SELECT a.id, a.email, a.name, m.group_id AS groupId, m.role, m.person_id AS personId, a.unit_system AS unitSystem, a.diet_preferences AS dietPreferences,
           (a.email = ? OR EXISTS (SELECT 1 FROM superusers su WHERE su.account_id = a.id)) AS superuser
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    JOIN group_memberships m ON m.account_id = a.id
    WHERE s.hash = ? AND s.expires > ?
    AND NOT EXISTS (SELECT 1 FROM administrative_blocks b
      WHERE (b.kind = 'account' AND b.id = a.id) OR (b.kind = 'group' AND b.id = m.group_id))
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
    const account = hash ? findSession.get(rootEmail, hash, Date.now()) : undefined
    return account && { ...account, dietPreferences: JSON.parse(account.dietPreferences), superuser: !!account.superuser }
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
  async function sendLink(kind, email, payload, lifetime) {
    const raw = token()
    const hash = digest(raw)
    const now = Date.now()
    db.prepare('DELETE FROM account_links WHERE expires <= ?').run(now)
    db.prepare('INSERT INTO account_links VALUES (?, ?, ?, ?, ?)').run(hash, kind, email, JSON.stringify(payload), now + lifetime)
    const url = new URL(publicUrl)
    url.hash = new URLSearchParams({ action: kind === 'reset' ? 'reset' : kind === 'superuser' ? 'accept-superuser' : 'accept', token: raw }).toString()
    try {
      const group = payload.groupId ? store.read(payload.groupId).state.household.name : payload.group
      await mail({ to: email, ...emailTemplates.render(kind, {
        naam: payload.name || byEmail.get(email)?.name || 'daar',
        groep: group || 'je huishouden',
        geldigheid: lifetime === 7 * day ? '7 dagen' : lifetime === day ? '24 uur' : '1 uur',
      }, url.href) })
      if (kind === 'invite') db.prepare("DELETE FROM account_links WHERE kind = 'invite' AND hash <> ? AND json_extract(payload, '$.groupId') = ? AND (email = ? OR (? IS NOT NULL AND json_extract(payload, '$.personId') = ?))")
        .run(hash, payload.groupId, email, payload.personId, payload.personId)

    } catch {
      removeLink.run(hash)
      throw new AuthError(503, 'E-mail versturen is nu niet gelukt. Probeer het later opnieuw.')
    }
  }

  function linkedPeople(groupId) {
    return db.prepare('SELECT person_id AS id FROM group_memberships WHERE group_id = ? AND person_id IS NOT NULL')
      .all(groupId).map(row => row.id)
  }
  function ownerPeople(groupId) {
    return db.prepare("SELECT person_id AS id FROM group_memberships WHERE group_id = ? AND role = 'owner' AND person_id IS NOT NULL").all(groupId).map(row => row.id)
  }
  function management() {
    const accounts = db.prepare(`
      SELECT a.id, a.email, a.name, a.created, m.role, m.group_id AS groupId,
             EXISTS (SELECT 1 FROM administrative_blocks b WHERE b.kind = 'account' AND b.id = a.id) AS blocked,
             (a.email = ? OR EXISTS (SELECT 1 FROM superusers su WHERE su.account_id = a.id)) AS superuser,
             EXISTS (SELECT 1 FROM superusers su WHERE su.account_id = a.id) AS granted
      FROM accounts a JOIN group_memberships m ON m.account_id = a.id ORDER BY a.created DESC, a.name
    `).all(rootEmail)
    const groups = db.prepare(`
      SELECT g.id, json_extract(g.data, '$.household.name') AS name,
             EXISTS (SELECT 1 FROM administrative_blocks b WHERE b.kind = 'group' AND b.id = g.id) AS blocked,
             (SELECT COUNT(*) FROM group_memberships m WHERE m.group_id = g.id) AS members,
             (SELECT MAX(a.created) FROM group_memberships m JOIN accounts a ON a.id = m.account_id
              WHERE m.group_id = g.id AND m.role = 'owner') AS created
      FROM group_states g ORDER BY created DESC, name
    `).all()
    return { accounts, groups }
  }
  async function authenticate(email, password) {
    throttle('login:' + email, 8)
    const account = byEmail.get(email)
    const [salt, expected] = (account?.password ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(':')
    const hash = await derive(passwordInput(password), salt, 64, scryptOptions)
    if (!timingSafeEqual(hash, Buffer.from(expected, 'hex')) || !account || byEmail.get(email)?.password !== account.password) {
      throw new AuthError(401, 'E-mailadres of wachtwoord klopt niet.')
    }
    const blocked = db.prepare(`
      SELECT 1 FROM group_memberships m JOIN administrative_blocks b
        ON (b.kind = 'account' AND b.id = m.account_id) OR (b.kind = 'group' AND b.id = m.group_id)
      WHERE m.account_id = ?
    `).get(account.id)
    if (blocked) throw new AuthError(403, 'Je account of groep is geblokkeerd.')
    return account
  }

  async function handle(route, body, request, current) {
    // The reverse proxy may share one socket address across visitors.
    const peer = request.socket.remoteAddress || 'unknown'
    if (route !== 'logout') throttle('network:' + route + ':' + peer, 60)
    switch (route) {
      case 'catalog-export':
        requireSuperuser(current)
        return moderation.exportCatalog(body.ids)
      case 'catalog-import':
        requireSuperuser(current)
        return moderation.importCatalog(current.groupId, body.bundle, body.ids)
      case 'email-templates':
        requireSuperuser(current)
        return { templates: emailTemplates.list() }
      case 'email-template-save':
        requireSuperuser(current)
        return emailTemplates.save(body.kind, body.template)
      case 'email-template-preview':
        requireSuperuser(current)
        return emailTemplates.preview(body.kind, body.template)
      case 'admin-overview':
        requireSuperuser(current)
        return { ...management(), publications: moderation.list(), terms: moderation.pendingTerms(), publicIngredients: store.publicTerms().ingredients }
      case 'public-recipe-edit':
        requireSuperuser(current)
        return moderation.editPublic(body.recipe)
      case 'publication-review':
        requireSuperuser(current)
        return moderation.review(body.id)
      case 'publication-decide':
        requireSuperuser(current)
        moderation.bulkDecide(body.ids ?? [body.id], body.status)
        return { message: 'Publicatiestatus opgeslagen.' }
      case 'ingredient-code-suggest':
        requireSuperuser(current)
        return moderation.suggestIngredientCode(body.name, body.id, body.reserved)
      case 'ingredient-edit':
        requireSuperuser(current)
        if (typeof body.id !== 'string' || (body.groupId !== undefined && typeof body.groupId !== 'string')) throw new InputError('Kies een ingrediënt.')
        moderation.editIngredient(body)
        return { message: 'Ingrediënt opgeslagen.' }
      case 'terms-publish': {
        requireSuperuser(current)
        if (!Array.isArray(body.terms) || !body.terms.length || body.terms.length > 20 ||
            body.terms.some(term => !term || typeof term !== 'object')) throw new InputError('Selecteer één tot twintig termen.')
        store.transaction(() => {
          for (const term of body.terms) moderation.publishTerm(term)
        })
        return { message: body.terms.length + ' termen gepubliceerd.' }
      }
      case 'term-publish':
        requireSuperuser(current)
        moderation.publishTerm(body)
        return { message: 'De term is gepubliceerd.' }
      case 'publication-submit':
        moderation.submit(requireLogin(current).groupId, body.id)
        return { message: 'Recept ingediend ter beoordeling.' }
      case 'profile': {
        const account = requireLogin(current)
        const name = label(body.name, 40, 'Vul je naam in.')
        const diet = body.dietPreferences ?? account.dietPreferences
        if (!Array.isArray(diet) || diet.some(tag => !dietTags.includes(tag))) throw new InputError('Kies geldige dieetvoorkeuren.')
        const unitSystem = body.unitSystem ?? account.unitSystem
        if (unitSystem !== 'metric' && unitSystem !== 'us') throw new InputError('Kies een maatstelsel.')
        const { state } = store.read(account.groupId)
        const person = state.people.find(item => item.id === account.personId)
        const factor = Number(body.factor)
        if (person && (!Number.isFinite(factor) || factor < 0.25 || factor > 4)) {
          throw new InputError('Kies een portiefactor tussen 0,25 en 4.')
        }
        store.transaction(() => {
          if (person) store.addGroupPerson(account.groupId, { ...person, name, factor })
          db.prepare('UPDATE accounts SET name = ?, unit_system = ?, diet_preferences = ? WHERE id = ?').run(name, unitSystem, JSON.stringify([...new Set(diet)]), account.id)
        })
        return { message: 'Profiel opgeslagen.' }
      }
      case 'admin-block': {
        requireSuperuser(current)
        const { kind, id, blocked } = body
        if (!['account', 'group'].includes(kind) || typeof id !== 'string' || typeof blocked !== 'boolean') {
          throw new InputError('Controleer de ingevulde gegevens.')
        }
        const target = kind === 'account' ? db.prepare('SELECT email FROM accounts WHERE id = ?').get(id)
          : db.prepare('SELECT id FROM group_states WHERE id = ?').get(id)
        if (!target) throw new InputError('Account of groep bestaat niet.')
        const root = rootEmail && byEmail.get(rootEmail)
        const rootGroup = root && db.prepare('SELECT group_id FROM group_memberships WHERE account_id = ?').get(root.id)?.group_id
        if (blocked && (kind === 'account' ? id === current.id || target.email === rootEmail
          : id === current.groupId || id === rootGroup)) throw new InputError('Dit account of deze groep kan niet worden geblokkeerd.')
        store.transaction(() => {
          if (blocked) {
            db.prepare('INSERT OR IGNORE INTO administrative_blocks VALUES (?, ?)').run(kind, id)
            if (kind === 'account') db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id)
            else db.prepare('DELETE FROM sessions WHERE account_id IN (SELECT account_id FROM group_memberships WHERE group_id = ?)').run(id)
          } else {
            db.prepare('DELETE FROM administrative_blocks WHERE kind = ? AND id = ?').run(kind, id)
          }
        })
        return { message: blocked ? 'Geblokkeerd.' : 'Toegang hersteld.' }
      }
      case 'admin-rename': {
        requireSuperuser(current)
        if (typeof body.id !== 'string') throw new InputError('Kies een groep.')
        const name = label(body.name, 80, 'Vul een groepsnaam in.')
        if (!db.prepare("UPDATE group_states SET data = json_set(data, '$.household.name', ?), revision = revision + 1 WHERE id = ?").run(name, body.id).changes) {
          throw new InputError('Groep bestaat niet.')
        }
        return { message: 'Groepsnaam opgeslagen.' }
      }
      case 'admin-revoke': {
        requireSuperuser(current)
        if (typeof body.id !== 'string') throw new InputError('Kies een account.')
        const target = db.prepare('SELECT email FROM accounts WHERE id = ?').get(body.id)
        if (!target || target.email === rootEmail || body.id === current.id) {
          throw new InputError('Deze beheerrechten kunnen niet worden ingetrokken.')
        }
        store.transaction(() => {
          db.prepare('DELETE FROM superusers WHERE account_id = ?').run(body.id)
          db.prepare("DELETE FROM account_links WHERE email = ? AND kind = 'superuser'").run(target.email)
        })
        return { message: 'Beheerrechten ingetrokken.' }
      }
      case 'invite-superuser': {
        requireSuperuser(current)
        const email = emailAddress(body.email)
        throttle('super-invite:' + email, 4)
        const account = byEmail.get(email)
        if (!account) throw new InputError('Dit e-mailadres moet eerst een Foodplan-account hebben.')
        if (email === rootEmail || db.prepare('SELECT 1 FROM superusers WHERE account_id = ?').get(account.id)) {
          throw new InputError('Dit account is al superuser.')
        }
        await sendLink('superuser', email, {}, day)
        return { message: 'Uitnodiging verstuurd.' }
      }
      case 'accept-superuser': {
        const link = readLink(body.token, ['superuser'])
        const account = await authenticate(link.email, body.password)
        return store.transaction(() => {
          readLink(body.token, ['superuser'])
          db.prepare('INSERT OR IGNORE INTO superusers VALUES (?)').run(account.id)
          removeLink.run(link.hash)
          return { headers: startSession(account.id) }
        })
      }
      case 'register': {
        const email = emailAddress(body.email)
        const name = label(body.name, 40, 'Vul je naam in.')
        const group = email === bootstrapEmail ? '' : label(body.group, 80, 'Vul een groepsnaam in.')
        throttle('register:' + email, 4)
        if (!byEmail.get(email)) {
          await sendLink('register', email, { name, group }, day)
        }
        return neutralMail
      }
      case 'invitations':
        requireOwner(current)
        return { invitations: db.prepare("SELECT email, expires, json_extract(payload, '$.personId') AS personId FROM account_links WHERE kind = 'invite' AND expires > ? AND json_extract(payload, '$.groupId') = ?").all(Date.now(), current.groupId) }
      case 'invite-revoke':
        requireOwner(current)
        db.prepare("DELETE FROM account_links WHERE kind = 'invite' AND json_extract(payload, '$.groupId') = ? AND json_extract(payload, '$.personId') = ?").run(current.groupId, body.personId)
        return { message: 'Uitnodiging ingetrokken.' }
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
        await sendLink('invite', email, { groupId: current.groupId, personId }, 7 * day)
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
          if (db.prepare("SELECT 1 FROM administrative_blocks WHERE kind = 'group' AND id = ?").get(groupId)) {
            throw new InputError('Deze groep is geblokkeerd.')
          }
          db.prepare('INSERT INTO accounts (id, email, name, password, created) VALUES (?, ?, ?, ?, ?)').run(id, link.email, name, password, Date.now())
          db.prepare('INSERT INTO group_memberships VALUES (?, ?, ?, ?)').run(id, groupId, link.kind === 'invite' ? 'member' : 'owner', personId)
          removeLink.run(link.hash)
          return { headers: startSession(id) }
        })
      }
      case 'login': {
        const email = emailAddress(body.email)
        const account = await authenticate(email, body.password)
        return { headers: startSession(account.id) }
      }
      case 'forgot': {
        const email = emailAddress(body.email)
        throttle('forgot:' + email, 4)
        if (byEmail.get(email)) {
          void sendLink('reset', email, {}, 60 * minute)
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
  return { session, handle, linkedPeople, ownerPeople, moderation }
}
