export type UnitSystem = 'metric' | 'us'

const units = {
  g: ['mass', 1, 'gram'],
  kg: ['mass', 1000, 'kilogram'],
  oz: ['mass', 28.349523125, 'ounce'],
  lb: ['mass', 453.59237, 'pound'],
  ml: ['volume', 1, 'milliliter'],
  l: ['volume', 1000, 'liter'],
  tl: ['volume', 5, 'theelepel'],
  el: ['volume', 15, 'eetlepel'],
  tsp: ['volume', 4.92892159375, 'US teaspoon'],
  tbsp: ['volume', 14.78676478125, 'US tablespoon'],
  'fl oz': ['volume', 29.5735295625, 'US fluid ounce'],
  cup: ['volume', 236.5882365, 'US cup'],
  cm: ['length', 1, 'centimeter'],
  in: ['length', 2.54, 'inch'],
  'st.': ['count', 1, 'stuk'],
  teen: ['count', 1, 'teen'],
} as const

export const unitChoices = Object.entries(units).map(([id, [, , label]]) => ({ id, label }))
export const isUnit = (value: string): value is keyof typeof units => Object.hasOwn(units, value)
const metric = new Set(['g', 'kg', 'ml', 'l', 'tl', 'el', 'cm'])
const spoons: Record<string, keyof typeof units> = { tl: 'tsp', el: 'tbsp', tsp: 'tl', tbsp: 'el' }

export function convertQuantity(value: number, unit: string, system: UnitSystem) {
  if (!isUnit(unit)) return { value, unit }
  const [dimension, factor] = units[unit]
  if (dimension === 'count' || metric.has(unit) === (system === 'metric')) return { value, unit }

  const base = value * factor
  let target: keyof typeof units
  if (Object.hasOwn(spoons, unit)) target = spoons[unit]
  else if (dimension === 'length') target = system === 'metric' ? 'cm' : 'in'
  else if (dimension === 'mass') target = system === 'metric' ? (base >= 1000 ? 'kg' : 'g') : (base >= units.lb[1] ? 'lb' : 'oz')
  else target = system === 'metric' ? (base >= 1000 ? 'l' : 'ml') : (base >= units.cup[1] ? 'cup' : 'fl oz')
  return { value: base / units[target][1], unit: target }
}
