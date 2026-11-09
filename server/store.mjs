import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ingredientById, recipes } from '../domain/catalog.ts'
import { addDays, datesFrom, diners, householdRecipes, shoppingItems, today, weekStart } from '../domain/planning.ts'

const nameOk = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
const idOk = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value)
const dateOk = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && addDays(value, 0) === value

function requireInput(valid) {
  if (!valid) throw new InputError('Controleer de ingevulde gegevens.')
}
export class InputError extends Error {}

function validateRecipe(recipe) {
  requireInput(recipe && idOk(recipe.id) && nameOk(recipe.title, 100) &&
    typeof recipe.subtitle === 'string' && recipe.subtitle.length <= 160 &&
    nameOk(recipe.cuisine, 80) && nameOk(recipe.description, 1600) &&
    Number.isInteger(recipe.minutes) && recipe.minutes >= 1 && recipe.minutes <= 600 &&
    ['gold', 'rose', 'green'].includes(recipe.theme) &&
    Array.isArray(recipe.tags) && recipe.tags.length <= 20 && recipe.tags.every(tag => nameOk(tag, 40)) &&
    recipe.amounts && typeof recipe.amounts === 'object' && !Array.isArray(recipe.amounts) &&
    Object.keys(recipe.amounts).length > 0 && Object.entries(recipe.amounts).every(([id, value]) =>
      Object.hasOwn(ingredientById, id) && Number.isFinite(value) && value > 0 && value <= 10000) &&
    Array.isArray(recipe.steps) && recipe.steps.length > 0 && recipe.steps.length <= 30 &&
    recipe.steps.every(step => nameOk(step, 600)))
  for (const step of recipe.steps) {
    const remaining = step.replace(/\{([a-z-]+)(?::(\d+(?:\.\d+)?))?\}/g, (_, id, factor) => {
      if (!Object.hasOwn(recipe.amounts, id) || (factor !== undefined && !(Number(factor) > 0 && Number(factor) <= 1))) {
        throw new InputError('Gebruik in de stappen alleen verwijzingen naar gekozen ingrediënten.')
      }
      return ''
    })
    if (/[{}]/.test(remaining)) throw new InputError('Een ingrediëntverwijzing in de stappen is ongeldig.')
  }
}

function importState(backup) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value)
  const unique = (values, key) => new Set(values.map(key)).size === values.length
  if (backup?.format !== 'aan-tafel' || backup.version !== 1 || !record(backup.state)) {
    throw new InputError('Kies een geldig Aan tafel-back-upbestand.')
  }

  const { people, meals, attendance, checked, extras, recipeEdits, includeStarterRecipes } = backup.state
  requireInput(includeStarterRecipes === undefined || typeof includeStarterRecipes === 'boolean')
  requireInput(Array.isArray(people) && people.every(person =>
    record(person) && idOk(person.id) && nameOk(person.name, 40) &&
    Number.isFinite(person.factor) && person.factor >= 0.25 && person.factor <= 4
  ) && unique(people, person => person.id))
  const peopleIds = new Set(people.map(person => person.id))

  if (recipeEdits !== undefined) {
    requireInput(record(recipeEdits))
    for (const [id, recipe] of Object.entries(recipeEdits)) {
      requireInput(recipe?.id === id)
      validateRecipe(recipe)
    }
  }
  const catalog = householdRecipes({ recipeEdits, includeStarterRecipes })
  requireInput(Array.isArray(meals) && meals.every(meal =>
    record(meal) && dateOk(meal.date) && idOk(meal.recipeId) && Object.hasOwn(catalog, meal.recipeId)
  ) && unique(meals, meal => meal.date))
  requireInput(record(attendance) && Object.entries(attendance).every(([date, ids]) =>
    dateOk(date) && Array.isArray(ids) && ids.every(id => peopleIds.has(id))
  ))
  requireInput(Array.isArray(checked) && checked.every(key => typeof key === 'string' && key.length <= 4096))
  requireInput(Array.isArray(extras) && extras.every(extra =>
    record(extra) && idOk(extra.id) && nameOk(extra.name, 100) && typeof extra.checked === 'boolean'
  ) && unique(extras, extra => extra.id))
  return { people, meals, attendance, checked, extras, recipeEdits, includeStarterRecipes }
}

function apply(state, action) {
  requireInput(action && typeof action === 'object')
  switch (action.type) {
    case 'clearDatabase':
      Object.assign(state, {
        people: [], meals: [], attendance: {}, checked: [], extras: [],
        recipeEdits: {}, includeStarterRecipes: false,
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
    case 'saveRecipe': {
      const recipe = action.recipe
      validateRecipe(recipe)
      const { id, title, subtitle, cuisine, description, minutes, theme, tags, amounts, steps } = recipe
      state.recipeEdits = { ...state.recipeEdits, [id]: {
        id, title: title.trim(), subtitle: subtitle.trim(), cuisine: cuisine.trim(),
        description: description.trim(), minutes, theme,
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
    CREATE TABLE IF NOT EXISTS household (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)
  const start = today()
  const initial = {
    people: [1, 2, 3].map(n => ({ id: 'demo-' + n, name: 'Persoon ' + n, factor: 1 })),
    meals: recipes.map((recipe, i) => ({ date: addDays(start, i), recipeId: recipe.id })),
    attendance: {}, checked: [], extras: [],
  }
  db.prepare('INSERT OR IGNORE INTO household VALUES (1, 0, ?)').run(JSON.stringify(initial))
  const select = db.prepare('SELECT revision, data FROM household WHERE id = 1')
  const update = db.prepare('UPDATE household SET revision = revision + 1, data = ? WHERE id = 1')
  function read() {
    const row = select.get()
    return { revision: row.revision, state: JSON.parse(row.data) }
  }
  return {
    read,
    write(action, restore = false) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const { state, revision } = read()
        const next = restore ? importState(action) : state
        if (!restore) apply(next, action)
        update.run(JSON.stringify(next))
        db.exec('COMMIT')
        return { state: next, revision: revision + 1 }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
