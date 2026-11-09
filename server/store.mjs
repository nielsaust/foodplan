import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ingredientById, recipes } from '../domain/catalog.ts'
import { baseTags, emptyTerms, nameKey } from '../domain/terms.ts'
import { isUnit } from '../domain/units.ts'
import { addDays, datesFrom, diners, householdRecipes, purchaseKey, shoppingItems, today, weekStart } from '../domain/planning.ts'

const nameOk = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
const idOk = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value)
const dateOk = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && addDays(value, 0) === value

function requireInput(valid) {
  if (!valid) throw new InputError('Controleer de ingevulde gegevens.')
}
export class InputError extends Error {}

const record = value => value && typeof value === 'object' && !Array.isArray(value)
const baseTagById = Object.fromEntries(baseTags.map(tag => [tag.id, tag]))

function localized(value, fields) {
  if (value === undefined) return true
  if (!record(value) || Object.keys(value).length > 30) return false
  return Object.entries(value).every(([locale, translation]) =>
    /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale) && record(translation) &&
    Object.entries(translation).every(([field, text]) =>
      Object.hasOwn(fields, field) && fields[field](text)))
}

const recipeTranslationFields = {
  title: value => nameOk(value, 100),
  subtitle: value => typeof value === 'string' && value.length <= 160,
  cuisine: value => nameOk(value, 80),
  description: value => nameOk(value, 1600),
  steps: value => Array.isArray(value) && value.length <= 30 && value.every(step => nameOk(step, 600)),
}

export function validateTerm(term, kind) {
  const ingredient = kind === 'ingredient'
  requireInput(record(term) && typeof term.id === 'string' && new RegExp('^' + kind + '-[a-f0-9]{32}$').test(term.id) &&
    nameOk(term.name, ingredient ? 80 : 40) && localized(term.translations, { name: value => nameOk(value, ingredient ? 80 : 40) }) && (!ingredient || (typeof term.unit === 'string' && isUnit(term.unit))))
  return ingredient
    ? { id: term.id, name: term.name.trim(), unit: term.unit, group: 'Overige ingrediënten', translations: term.translations }
    : { id: term.id, name: term.name.trim(), translations: term.translations }
}

function readTerms(value, kind) {
  if (value === undefined) return {}
  requireInput(record(value))
  return Object.fromEntries(Object.entries(value).map(([id, term]) => {
    requireInput(term?.id === id)
    return [id, validateTerm(term, kind)]
  }))
}

function prepareTerms(state, recipe, additions, publicTerms) {
  requireInput(record(recipe) && record(recipe.amounts) && (recipe.tagIds === undefined || Array.isArray(recipe.tagIds)))
  const customIngredients = { ...state.customIngredients }
  const customTags = { ...state.customTags }
  const availableIngredients = { ...ingredientById, ...customIngredients, ...Object.fromEntries(publicTerms.ingredients.map(item => [item.id, item])) }
  const availableTags = { ...baseTagById, ...customTags, ...Object.fromEntries(publicTerms.tags.map(item => [item.id, item])) }
  requireInput(record(additions) && Array.isArray(additions.ingredients) && additions.ingredients.length <= 50 &&
    Array.isArray(additions.tags) && additions.tags.length <= 20)
  for (const entry of additions.ingredients) {
    const term = validateTerm(entry, 'ingredient')
    requireInput(!Object.hasOwn(availableIngredients, term.id) && Object.hasOwn(recipe.amounts, term.id))
    if (Object.values(availableIngredients).some(item => nameKey(item.name) === nameKey(term.name))) {
      throw new InputError('Dit ingrediënt bestaat al. Kies het uit de suggesties.')
    }
    availableIngredients[term.id] = term
  }
  for (const entry of additions.tags) {
    const term = validateTerm(entry, 'tag')
    requireInput(!Object.hasOwn(availableTags, term.id) && recipe.tagIds?.includes(term.id))
    if (Object.values(availableTags).some(item => nameKey(item.name) === nameKey(term.name))) {
      throw new InputError('Dit kenmerk bestaat al. Kies het uit de suggesties.')
    }
    availableTags[term.id] = term
  }
  validateRecipe(recipe, availableIngredients, availableTags)
  for (const id of Object.keys(recipe.amounts)) {
    if (!Object.hasOwn(ingredientById, id)) customIngredients[id] = availableIngredients[id]
  }
  for (const id of recipe.tagIds ?? []) {
    if (!Object.hasOwn(baseTagById, id)) customTags[id] = availableTags[id]
  }
  state.customIngredients = customIngredients
  state.customTags = customTags
  return recipe.tagIds ? { ...recipe, tags: recipe.tagIds.map(id => availableTags[id].name) } : recipe
}

function validSource(source) {
  if (source === null || source === undefined) return true
  if (!nameOk(source, 2048)) return false
  try {
    const url = new URL(source)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

export function validateRecipe(recipe, ingredients = ingredientById, tags = baseTagById) {
  requireInput(recipe && idOk(recipe.id) && nameOk(recipe.title, 100) &&
    typeof recipe.subtitle === 'string' && recipe.subtitle.length <= 160 &&
    nameOk(recipe.cuisine, 80) && nameOk(recipe.description, 1600) && validSource(recipe.source) &&
    Number.isInteger(recipe.minutes) && recipe.minutes >= 1 && recipe.minutes <= 600 &&
    ['gold', 'rose', 'green'].includes(recipe.theme) &&
    (recipe.image === undefined || (typeof recipe.image === 'string' && recipe.image.length <= 140000 &&
      /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(recipe.image) &&
      Buffer.from(recipe.image.split(',')[1], 'base64').toString('ascii', 8, 12) === 'WEBP')) &&
    Array.isArray(recipe.tags) && recipe.tags.length <= 20 && recipe.tags.every(tag => nameOk(tag, 40)) &&
    (recipe.tagIds === undefined || (Array.isArray(recipe.tagIds) && recipe.tagIds.length <= 20 &&
      recipe.tagIds.every(id => typeof id === 'string' && Object.hasOwn(tags, id)) &&
      new Set(recipe.tagIds).size === recipe.tagIds.length)) &&
    recipe.amounts && typeof recipe.amounts === 'object' && !Array.isArray(recipe.amounts) &&
    Object.keys(recipe.amounts).length > 0 && Object.entries(recipe.amounts).every(([id, value]) =>
      Object.hasOwn(ingredients, id) && Number.isFinite(value) && value > 0 && value <= 10000) &&
    localized(recipe.translations, recipeTranslationFields) &&
    Array.isArray(recipe.steps) && recipe.steps.length > 0 && recipe.steps.length <= 30 &&
    recipe.steps.every(step => nameOk(step, 600)))
  const translatedSteps = Object.values(recipe.translations ?? {}).flatMap(translation => translation.steps ?? [])
  for (const step of [...recipe.steps, ...translatedSteps]) {
    const remaining = step.replace(/\{([a-z0-9-]+)(?::(\d+(?:\.\d+)?))?\}/g, (_, id, factor) => {
      if (!Object.hasOwn(recipe.amounts, id) || (factor !== undefined && !(Number(factor) > 0 && Number(factor) <= 1))) {
        throw new InputError('Gebruik in de stappen alleen verwijzingen naar gekozen ingrediënten.')
      }
      return ''
    })
    if (/[{}]/.test(remaining)) throw new InputError('Een ingrediëntverwijzing in de stappen is ongeldig.')
  }
}

function importState(backup) {
  const unique = (values, key) => new Set(values.map(key)).size === values.length
  if (backup?.format !== 'aan-tafel' || backup.version !== 1 || !record(backup.state)) {
    throw new InputError('Kies een geldig Aan tafel-back-upbestand.')
  }

  const { household, people, meals, attendance, checked, purchased, extras, recipeEdits, includeStarterRecipes } = backup.state
  requireInput(household === undefined || (record(household) && idOk(household.id) && nameOk(household.name, 80)))
  requireInput(includeStarterRecipes === undefined || typeof includeStarterRecipes === 'boolean')
  requireInput(Array.isArray(people) && people.every(person =>
    record(person) && idOk(person.id) && nameOk(person.name, 40) &&
    Number.isFinite(person.factor) && person.factor >= 0.25 && person.factor <= 4
  ) && unique(people, person => person.id))
  const peopleIds = new Set(people.map(person => person.id))

  const customIngredients = readTerms(backup.state.customIngredients, 'ingredient')
  const customTags = readTerms(backup.state.customTags, 'tag')
  if (recipeEdits !== undefined) {
    requireInput(record(recipeEdits))
    for (const [id, recipe] of Object.entries(recipeEdits)) {
      requireInput(recipe?.id === id)
      validateRecipe(recipe, { ...ingredientById, ...customIngredients }, { ...baseTagById, ...customTags })
    }
  }
  const catalog = householdRecipes({ recipeEdits, includeStarterRecipes })
  requireInput(Array.isArray(meals) && meals.every(meal =>
    record(meal) && dateOk(meal.date) && idOk(meal.recipeId) && Object.hasOwn(catalog, meal.recipeId)
  ) && unique(meals, meal => meal.date))
  requireInput(record(attendance) && Object.entries(attendance).every(([date, ids]) =>
    dateOk(date) && Array.isArray(ids) && ids.every(id => peopleIds.has(id))
  ))
  requireInput(purchased === undefined || (Array.isArray(purchased) && purchased.every(key => typeof key === 'string' && key.length <= 4096)))
  requireInput(Array.isArray(checked) && checked.every(key => typeof key === 'string' && key.length <= 4096))
  requireInput(Array.isArray(extras) && extras.every(extra =>
    record(extra) && idOk(extra.id) && nameOk(extra.name, 100) && typeof extra.checked === 'boolean'
  ) && unique(extras, extra => extra.id))
  return { household, people, meals, attendance, checked, purchased, extras, recipeEdits, includeStarterRecipes, customIngredients, customTags }
}

function apply(state, action, publicTerms = emptyTerms) {
  requireInput(action && typeof action === 'object')
  switch (action.type) {
    case 'clearDatabase':
      Object.assign(state, {
        people: [], meals: [], attendance: {}, checked: [], purchased: [], extras: [],
        recipeEdits: {}, customIngredients: {}, customTags: {}, includeStarterRecipes: false,
      })
      break
    case 'person': {
      requireInput(idOk(action.id) && nameOk(action.name, 40) &&
        Number.isFinite(action.factor) && action.factor >= 0.25 && action.factor <= 4)
      const person = { id: action.id, name: action.name.trim(), factor: action.factor }
      const index = state.people.findIndex(item => item.id === person.id)
      if (index < 0) state.people.push(person)
      else state.people[index] = person
      break
    }
    case 'removePerson':
      requireInput(idOk(action.id))
      state.people = state.people.filter(item => item.id !== action.id)
      for (const date of Object.keys(state.attendance)) {
        state.attendance[date] = state.attendance[date].filter(id => id !== action.id)
      }
      break
    case 'deleteRecipe': {
      requireInput(typeof action.id === 'string' && Object.hasOwn(state.recipeEdits ?? {}, action.id))
      const dates = new Set(state.meals.filter(meal => meal.recipeId === action.id).map(meal => meal.date))
      const keep = (key, isPurchase) => {
        try {
          const [, uses] = JSON.parse(key)
          return isPurchase ? !dates.has(uses) : !Array.isArray(uses) || !uses.some(use => dates.has(use?.[0]))
        } catch { return true }
      }
      state.checked = state.checked.filter(key => keep(key, false))
      state.purchased = (state.purchased ?? []).filter(key => keep(key, true))
      delete state.recipeEdits[action.id]
      state.meals = state.meals.filter(meal => meal.recipeId !== action.id)
      break
    }
    case 'saveRecipe': {
      const recipe = prepareTerms(state, action.recipe, action.terms ?? emptyTerms, publicTerms)
      requireInput(!recipes.some(starter => starter.id === recipe.id) || Object.hasOwn(state.recipeEdits ?? {}, recipe.id))
      const { image, id, title, subtitle, cuisine, description, minutes, theme, tags, tagIds, amounts, steps, translations, source } = recipe
      state.recipeEdits = { ...state.recipeEdits, [id]: {
        id, image, tagIds, translations, title: title.trim(), subtitle: subtitle.trim(), cuisine: cuisine.trim(),
        description: description.trim(), source: source?.trim() ?? source, minutes, theme,
        tags: [...new Set(tags.map(tag => tag.trim()))], amounts, steps: steps.map(step => step.trim()),
      } }
      break
    }
    case 'moveMeal': {
      requireInput(dateOk(action.from) && dateOk(action.to) && action.from !== action.to && idOk(action.recipeId))
      const meal = state.meals.find(item => item.date === action.from)
      const destination = state.meals.find(item => item.date === action.to)
      if (!meal && destination?.recipeId === action.recipeId) break
      if (meal?.recipeId !== action.recipeId) throw new InputError('De maaltijd op de oorspronkelijke dag is veranderd.')
      if (destination) throw new InputError('Op die dag staat al een maaltijd. Kies een vrije dag.')
      meal.date = action.to
      break
    }
    case 'meal':
      requireInput(dateOk(action.date) && (action.recipeId === null || (idOk(action.recipeId) && Object.hasOwn(householdRecipes(state), action.recipeId))))
      state.meals = state.meals.filter(item => item.date !== action.date)
      if (action.recipeId) state.meals.push({ date: action.date, recipeId: action.recipeId })
      break
    case 'copyWeek': {
      requireInput(dateOk(action.from) && weekStart(action.from) === action.from)
      const dates = new Set(datesFrom(action.from, 7))
      for (const meal of state.meals.filter(item => dates.has(item.date))) {
        const date = addDays(meal.date, 7)
        if (!state.meals.some(item => item.date === date)) state.meals.push({ ...meal, date })
      }
      break
    }
    case 'attendance': {
      requireInput(dateOk(action.date) && typeof action.present === 'boolean' && state.people.some(item => item.id === action.id))
      const ids = new Set(diners(state, action.date).map(item => item.id))
      if (action.present) ids.add(action.id)
      else ids.delete(action.id)
      state.attendance[action.date] = [...ids]
      break
    }
    case 'removeChecked': {
      requireInput(dateOk(action.start) && Number.isInteger(action.days) && action.days >= 1 && action.days <= 14)
      const items = shoppingItems(state, action.start, action.days).filter(item => item.checked)
      const removed = new Set(items.map(item => item.key))
      const purchased = new Set(state.purchased)
      for (const item of items) {
        for (const [date, quantity] of item.uses) purchased.add(purchaseKey(item.id, date, quantity))
      }
      state.purchased = [...purchased]
      state.checked = state.checked.filter(key => !removed.has(key))
      state.extras = state.extras.filter(item => !item.checked)
      break
    }
    case 'check':
      requireInput(dateOk(action.start) && Number.isInteger(action.days) && action.days >= 1 && action.days <= 14 &&
        typeof action.key === 'string' && typeof action.checked === 'boolean')
      if (!shoppingItems(state, action.start, action.days).some(item => item.key === action.key)) {
        throw new InputError('De boodschappenlijst is veranderd. Probeer het opnieuw.')
      }
      state.checked = state.checked.filter(key => key !== action.key)
      if (action.checked) state.checked.push(action.key)
      break
    case 'extra':
      requireInput(idOk(action.id) && nameOk(action.name, 100))
      if (!state.extras.some(item => item.id === action.id)) {
        state.extras.push({ id: action.id, name: action.name.trim(), checked: false })
      }
      break
    case 'checkExtra':
      requireInput(idOk(action.id) && typeof action.checked === 'boolean')
      for (const item of state.extras) {
        if (item.id === action.id) item.checked = action.checked
      }
      break
    case 'removeExtra':
      requireInput(idOk(action.id))
      state.extras = state.extras.filter(item => item.id !== action.id)
      break
    default:
      throw new InputError('Onbekende actie.')
  }
}

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS public_terms (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('ingredient', 'tag')),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_states (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
  `)
  const configuredName = process.env.FOODPLAN_HOUSEHOLD_NAME?.trim()
  const memberNames = (process.env.FOODPLAN_MEMBER_NAMES || undefined)?.split(',').map(name => name.trim())
  requireInput(!configuredName || nameOk(configuredName, 80))
  requireInput(!memberNames || (memberNames.length === 3 && memberNames.every(name => nameOk(name, 40))))

  function configureHousehold(state) {
    let changed = false
    if (!state.household || (configuredName && state.household.name !== configuredName)) {
      state.household = {
        id: state.household?.id ?? 'household-1',
        name: configuredName || 'Mijn huishouden',
      }
      changed = true
    }
    for (const [index, name] of (memberNames ?? []).entries()) {
      const number = index + 1
      const member = state.people.find(person => person.id === 'demo-' + number && person.name === 'Persoon ' + number)
      if (member && member.name !== name) {
        member.name = name
        changed = true
      }
    }
    return changed
  }

  const start = today()
  const initial = {
    people: [1, 2, 3].map(n => ({ id: 'demo-' + n, name: 'Persoon ' + n, factor: 1 })),
    meals: recipes.map((recipe, i) => ({ date: addDays(start, i), recipeId: recipe.id })),
    attendance: {}, checked: [], extras: [],
  }
  configureHousehold(initial)
  const select = db.prepare('SELECT revision, data FROM group_states WHERE id = ?')
  const update = db.prepare('UPDATE group_states SET revision = revision + 1, data = ? WHERE id = ?')
  const insert = db.prepare('INSERT INTO group_states (id, revision, data) VALUES (?, ?, ?)')
  function read(groupId) {
    const row = select.get(groupId)
    return { revision: row.revision, state: JSON.parse(row.data) }
  }
  function publicTerms() {
    const terms = { ingredients: [], tags: [] }
    for (const row of db.prepare('SELECT kind, data FROM public_terms').all()) {
      terms[row.kind === 'ingredient' ? 'ingredients' : 'tags'].push(JSON.parse(row.data))
    }
    return terms
  }
  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const legacyGroupId = 'household-1'
  transaction(() => {
    const legacyTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'household'").get()
    if (legacyTable && !select.get(legacyGroupId)) {
      const row = db.prepare('SELECT revision, data FROM household WHERE id = 1').get()
      const state = row ? JSON.parse(row.data) : initial
      configureHousehold(state)
      state.household.id = legacyGroupId
      insert.run(legacyGroupId, row?.revision ?? 0, JSON.stringify(state))
      db.exec('DROP TABLE household')
    } else if (!select.get(legacyGroupId)) {
      insert.run(legacyGroupId, 0, JSON.stringify(initial))
    }
  })

  return {
    db, transaction, legacyGroupId, read, publicTerms,
    createGroup(groupId, name) {
      insert.run(groupId, 0, JSON.stringify({
        household: { id: groupId, name }, people: [], meals: [], attendance: {}, checked: [], extras: [],
      }))
    },
    write(groupId, action, restore = false) {
      return transaction(() => {
        const { state, revision } = read(groupId)
        const next = restore ? importState(action) : state
        if (restore) next.household = state.household
        else apply(next, action, action?.type === 'saveRecipe' ? publicTerms() : undefined)
        if (!restore && action.type === 'deleteRecipe' && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'recipe_publications'").get()) {
          db.prepare("DELETE FROM recipe_publications WHERE group_id = ? AND recipe_id = ? AND status = 'pending'").run(groupId, action.id)
        }
        update.run(JSON.stringify(next), groupId)
        return { state: next, revision: revision + 1 }
      })
    },
    addGroupPerson(groupId, person) {
      const { state } = read(groupId)
      apply(state, { type: 'person', ...person })
      update.run(JSON.stringify(state), groupId)
    },
  }
}
