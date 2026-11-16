import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ingredientById } from '../domain/catalog.ts'
import { baseTags, nameKey } from '../domain/terms.ts'
import { isUnit, quantityInUnit } from '../domain/units.ts'
import { AuthError } from './auth.mjs'
import { InputError } from './store.mjs'

const digest = code => createHash('sha256').update(code).digest('hex')
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
function check(valid, message) {
  if (!valid) throw new InputError(message)
}

export function importAction(body, state, publicTerms) {
  const fields = ['title', 'subtitle', 'cuisine', 'description', 'minutes', 'servings', 'source', 'ingredients', 'steps', 'tags', 'nutrition']
  check(record(body) && Object.keys(body).every(key => fields.includes(key)), 'Stuur een receptobject met alleen de velden uit de instructie.')
  check(text(body.title, 100) && typeof body.subtitle === 'string' && body.subtitle.length <= 160 &&
    text(body.cuisine, 80) && text(body.description, 1600), 'Vul title, subtitle, cuisine en description in volgens de instructie.')
  check(Number.isInteger(body.minutes) && body.minutes >= 1 && body.minutes <= 600, 'minutes moet een geheel getal van 1 tot 600 zijn.')
  check(Number.isFinite(body.servings) && body.servings > 0 && body.servings <= 100, 'Geef servings op: het oorspronkelijke aantal porties, groter dan 0 en maximaal 100.')
  check(body.source === null || text(body.source, 2048), 'Geef source op als bronlink of null voor een eigen recept.')
  check(Array.isArray(body.ingredients) && body.ingredients.length >= 1 && body.ingredients.length <= 50, 'Geef 1 tot 50 ingrediënten op.')
  check(Array.isArray(body.steps) && body.steps.length >= 1 && body.steps.length <= 30 && body.steps.every(step => text(step, 600)), 'Geef 1 tot 30 bereidingsstappen van maximaal 600 tekens op.')
  check(Array.isArray(body.tags) && body.tags.length <= 20 && body.tags.every(tag => text(tag, 40)), 'Geef tags op als een lijst met maximaal 20 kenmerken; [] mag.')
  const available = [...Object.values(ingredientById), ...Object.values(state.customIngredients ?? {}), ...publicTerms.ingredients]
    .filter(item => !state.retiredIngredientIds?.includes(item.id))
  const knownTags = [...baseTags, ...Object.values(state.customTags ?? {}), ...publicTerms.tags]
  const terms = { ingredients: [], tags: [] }
  const keys = new Map()
  const amounts = {}
  for (const entry of body.ingredients) {
    check(record(entry) && Object.keys(entry).every(key => ['key', 'name', 'amount', 'unit'].includes(key)) &&
      typeof entry.key === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(entry.key) && !keys.has(entry.key) &&
      text(entry.name, 80) && isUnit(entry.unit) && Number.isFinite(entry.amount) && entry.amount > 0,
    'Elk ingrediënt vereist een unieke key, name, positieve numerieke amount en toegestane unit.')
    let ingredient = available.find(item => nameKey(item.name) === nameKey(entry.name))
    if (!ingredient) {
      ingredient = { id: 'ingredient-' + randomBytes(16).toString('hex'), name: entry.name.trim(), unit: entry.unit }
      terms.ingredients.push(ingredient)
      available.push(ingredient)
    }
    const value = quantityInUnit(entry.amount / body.servings, entry.unit, ingredient.unit)
    check(value !== undefined, `Ingrediënt ${entry.name} bestaat met eenheid ${ingredient.unit}. Geef de hoeveelheid in die eenheid; vraag door als de omrekening onbekend is.`)
    amounts[ingredient.id] = (amounts[ingredient.id] ?? 0) + value
    check(amounts[ingredient.id] > 0 && amounts[ingredient.id] <= 10000, `De hoeveelheid voor ${entry.name} per portie moet groter dan 0 en maximaal 10000 zijn.`)
    keys.set(entry.key, ingredient.id)
  }
  const tagIds = [...new Set(body.tags.map(name => {
    let tag = knownTags.find(item => nameKey(item.name) === nameKey(name))
    if (!tag) {
      tag = { id: 'tag-' + randomBytes(16).toString('hex'), name: name.trim() }
      terms.tags.push(tag)
      knownTags.push(tag)
    }
    return tag.id
  }))]
  const steps = body.steps.map(step => step.replace(/\{([a-z0-9-]+)(:[^}]+)?\}/g, (_, key, fraction = '') => {
    check(keys.has(key), `Onbekende ingrediëntverwijzing {${key}} in steps.`)
    return '{' + keys.get(key) + fraction + '}'
  }))
  return { type: 'saveRecipe', terms, recipe: {
    id: randomUUID(), title: body.title, subtitle: body.subtitle, cuisine: body.cuisine,
    description: body.description, minutes: body.minutes, source: body.source, theme: 'green',
    amounts, steps, tags: body.tags, tagIds, ...(body.nutrition === undefined ? {} : { nutrition: body.nutrition }),
  } }
}

export function createRecipeImport(store) {
  const { db } = store
  db.exec(`CREATE TABLE IF NOT EXISTS recipe_import_links (
    hash TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES group_states(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    expires INTEGER NOT NULL
  )`)
  function active(code) {
    if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(code)) return undefined
    return db.prepare(`SELECT l.* FROM recipe_import_links l
      JOIN group_memberships m ON m.account_id = l.account_id AND m.group_id = l.group_id
      WHERE l.hash = ? AND l.expires > ? AND NOT EXISTS (
        SELECT 1 FROM administrative_blocks b WHERE (b.kind = 'account' AND b.id = l.account_id)
        OR (b.kind = 'group' AND b.id = l.group_id)
      )`).get(digest(code), Date.now())
  }
  function requireActive(code) {
    const link = active(code)
    if (!link) throw new AuthError(401, 'De importlink is verlopen, vervangen of al gebruikt. Maak in Huishouden een nieuwe instructie.')
    return link
  }
  return {
    requireActive,
    create(account) {
      if (!account) throw new AuthError(401, 'Log in om een importlink te maken.')
      return store.transaction(() => {
        const code = randomBytes(32).toString('base64url')
        const expires = Date.now() + 15 * 60 * 1000
        db.prepare('DELETE FROM recipe_import_links WHERE expires <= ? OR (account_id = ? AND group_id = ?)').run(Date.now(), account.id, account.groupId)
        db.prepare('INSERT INTO recipe_import_links VALUES (?, ?, ?, ?)').run(digest(code), account.groupId, account.id, expires)
        return { path: '/api/recipe-import?code=' + code, expiresAt: new Date(expires).toISOString() }
      })
    },
    receive(code, body) {
      return store.transaction(() => {
        const link = requireActive(code)
        const action = importAction(body, store.withCatalog(store.read(link.group_id).state), store.publicTerms())
        store.write(link.group_id, action)
        db.prepare('DELETE FROM recipe_import_links WHERE hash = ?').run(link.hash)
        return { recipe: { id: action.recipe.id, title: action.recipe.title.trim() }, message: 'Recept toegevoegd aan je huishouden.' }
      })
    },
  }
}
