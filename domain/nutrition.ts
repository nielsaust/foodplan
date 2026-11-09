import type { Recipe } from './catalog.ts'

// Representative values from food composition data and product labels.
// Values are per 100 g/ml, or per unit where indicated by the divisor.
const foods: Record<string, [kcal: number, protein: number, fiber: number, divisor: number]> = {
  tofu: [113, 13, 2.1, 100], chickpeas: [139, 7, 6.4, 100],
  lentils: [118, 10.6, 7.9, 100], edamame: [121, 11.9, 5.2, 100],
  spinach: [23, 2.9, 2.2, 100], cauliflower: [25, 1.9, 2, 100],
  mushroom: [22, 3.1, 1, 100], onion: [44, 1.2, 1.9, 1],
  garlic: [4.5, .19, .06, 1], lemon: [12, .2, .1, 1],
  zucchini: [17, 1.2, 1, 100], carrot: [41, .9, 2.8, 100],
  paksoi: [13, 1.5, 1, 100], ginger: [4, .09, .1, 1],
  rice: [370, 7.9, 3.5, 100], pasta: [355, 7.5, 3.5, 100],
  coconut: [75, .7, 0, 100], tomatoes: [22, 1.1, 1.2, 100],
  paste: [82, 4.3, 4.1, 100], cheese: [390, 27, 0, 100],
  oil: [810, 0, 0, 100], sesame: [810, 0, 0, 100], tamari: [60, 10, 0, 100],
  turmeric: [9, .3, .6, 1], cumin: [8, .4, .2, 1], curry: [7, .3, .7, 1],
  italian: [3, .1, .4, 1], paprika: [7, .3, .8, 1], pepper: [6, .2, .6, 1], water: [0, 0, 0, 1],
}

export function nutrition(recipe: Recipe) {
  const totals = { kcal: 0, protein: 0, fiber: 0 }
  for (const [id, quantity] of Object.entries(recipe.amounts)) {
    const food = foods[id]
    if (!food) return undefined
    const [kcal, protein, fiber, divisor] = food
    totals.kcal += kcal * quantity / divisor
    totals.protein += protein * quantity / divisor
    totals.fiber += fiber * quantity / divisor
  }
  return {
    kcal: Math.round(totals.kcal / 5) * 5,
    protein: Math.round(totals.protein),
    fiber: Math.round(totals.fiber),
  }
}
