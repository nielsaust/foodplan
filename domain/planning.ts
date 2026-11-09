import type { Recipe } from './catalog.ts'
import { ingredientById, recipeById } from './catalog.ts'

export type Person = { id: string; name: string; factor: number }
export type Meal = { date: string; recipeId: string }
export type Extra = { id: string; name: string; checked: boolean }
export type State = {
  household: { id: string; name: string }
  includeStarterRecipes?: boolean
  recipeEdits?: Record<string, Recipe>
  people: Person[]
  meals: Meal[]
  attendance: Record<string, string[]>
  checked: string[]
  purchased?: string[]
  extras: Extra[]
}
export const householdRecipes = (state: State) => ({ ...(state.includeStarterRecipes === false ? {} : recipeById), ...state.recipeEdits })

export type Action =
  | { type: 'clearDatabase' }
  | { type: 'saveRecipe'; recipe: Recipe }
  | { type: 'moveMeal'; from: string; to: string; recipeId: string }
  | { type: 'person'; id: string; name: string; factor: number }
  | { type: 'removePerson'; id: string }
  | { type: 'meal'; date: string; recipeId: string | null }
  | { type: 'copyWeek'; from: string }
  | { type: 'attendance'; date: string; id: string; present: boolean }
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
export const amount = (value: number, unit: string) => quantity.format(value) + ' ' + unit

export const purchaseKey = (id: string, date: string, quantity: number) => JSON.stringify([id, date, quantity])

export function shoppingItems(state: State, start: string, days: number) {
  const catalog = householdRecipes(state)
  const purchased = new Set(state.purchased)
  const totals = new Map<string, { total: number; uses: [string, number][] }>()
  for (const date of datesFrom(start, days)) {
    const meal = state.meals.find(item => item.date === date)
    const scale = portions(diners(state, date))
    if (!meal || !scale) continue
    for (const [id, base] of Object.entries(catalog[meal.recipeId].amounts)) {
      if (!ingredientById[id].group) continue
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
    return { ...ingredientById[id], ...entry, key, checked: state.checked.includes(key) }
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}
