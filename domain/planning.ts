import type { Ingredient, Recipe } from './catalog.ts'
import { ingredientById, recipeById } from './catalog.ts'
import type { Terms, Tag } from './terms.ts'
import { convertQuantity } from './units.ts'
import type { UnitSystem } from './units.ts'

export type Person = { id: string; name: string; factor: number }
export type Meal = { date: string; recipeId: string; text?: string }
export type Extra = { id: string; name: string; checked: boolean }
export type State = {
  household: { id: string; name: string }
  includeStarterRecipes?: boolean
  linkedPeople?: string[]
  customIngredients?: Record<string, Ingredient>
  customTags?: Record<string, Tag>
  publicRecipes?: Record<string, Recipe>
  archivedRecipeIds?: string[]
  publicIngredients?: Record<string, Ingredient>
  recipeEdits?: Record<string, Recipe>
  people: Person[]
  meals: Meal[]
  attendance: Record<string, string[]>
  checked: string[]
  purchased?: string[]
  extras: Extra[]
}
export const householdRecipes = (state: State) => ({ ...(state.publicRecipes ?? (state.includeStarterRecipes === false ? {} : recipeById)), ...state.recipeEdits })

export const canScheduleRecipe = (state: State, id: string) =>
  Object.hasOwn(householdRecipes(state), id) && (!state.archivedRecipeIds?.includes(id) || Object.hasOwn(state.recipeEdits ?? {}, id))

export const householdIngredients = (state: State) => ({ ...ingredientById, ...state.publicIngredients, ...state.customIngredients })

export type Action =
  | { type: 'clearDatabase' }
  | { type: 'copyPublicRecipe'; id: string; copyId: string }
  | { type: 'deleteRecipe'; id: string }
  | { type: 'saveRecipe'; recipe: Recipe; terms?: Terms }
  | { type: 'moveMeal'; from: string; to: string; recipeId: string; text?: string; insert?: boolean }
  | { type: 'person'; id: string; name: string; factor: number }
  | { type: 'removePerson'; id: string }
  | { type: 'meal'; date: string; recipeId: string | null; text?: string }
  | { type: 'copyWeek'; from: string }
  | { type: 'attendance'; date: string; id: string; present: boolean }
  | { type: 'checkAll'; start: string; days: number; checked?: boolean }
  | { type: 'removeChecked'; start: string; days: number }
  | { type: 'check'; key: string; checked: boolean; start: string; days: number }
  | { type: 'extra'; id: string; name: string }
  | { type: 'checkExtra'; id: string; checked: boolean }
  | { type: 'removeExtra'; id: string }

const zone = 'Europe/Amsterdam'
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(new Date())
const utcDate = (date: string) => new Date(date + 'T12:00:00Z')
export function addDays(date: string, days: number) {
  const value = utcDate(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export const weekStart = (date: string) => addDays(date, -((utcDate(date).getUTCDay() + 6) % 7))
export const datesFrom = (date: string, days: number) => Array.from({ length: days }, (_, i) => addDays(date, i))
export const formatDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('nl-NL', { ...options, timeZone: 'UTC' }).format(utcDate(date))

export const diners = (state: State, date: string) =>
  state.people.filter(person => (state.attendance[date] ?? state.people.map(item => item.id)).includes(person.id))

export const portions = (people: Person[]) => people.reduce((total, person) => total + person.factor, 0)
const quantity = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
export function cookingQuantity(value: number, unit: string) {
  const step = unit === 'teen' ? 1 : unit === 'tl' || unit === 'st.' ? 0.5 : 0
  return step && value > 0 ? Math.max(step, Math.ceil(value / step - 1e-9) * step) : value
}

export function ingredientAmount(value: number, unit: string, system: UnitSystem = 'metric', fraction = 1) {
  const converted = convertQuantity(value, unit, system)
  const rounded = converted.unit === unit ? cookingQuantity(value, unit) : converted.value
  return amount(rounded * fraction, converted.unit)
}
export const amount = (value: number, unit: string) => quantity.format(value) + ' ' + unit

export const purchaseKey = (id: string, date: string, quantity: number) => JSON.stringify([id, date, quantity])

export function shoppingItems(state: State, start: string, days: number) {
  const catalog = householdRecipes(state)
  const ingredients = householdIngredients(state)
  const purchased = new Set(state.purchased)
  const totals = new Map<string, { total: number; uses: [string, number][] }>()
  for (const date of datesFrom(start, days)) {
    const meal = state.meals.find(item => item.date === date)
    const scale = portions(diners(state, date))
    if (!meal || !scale || !catalog[meal.recipeId]) continue
    for (const [id, base] of Object.entries(catalog[meal.recipeId].amounts)) {
      if (!ingredients[id].group) continue
      const value = base * scale
      if (purchased.has(purchaseKey(id, date, value))) continue
      const entry = totals.get(id) ?? { total: 0, uses: [] }
      entry.total += value
      entry.uses.push([date, value])
      totals.set(id, entry)
    }
  }
  return [...totals].map(([id, entry]) => {
    const key = JSON.stringify([id, entry.uses])
    return { ...ingredients[id], ...entry, key, checked: state.checked.includes(key) }
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}
