import type { Localized } from './terms.ts'

export type Ingredient = {
  id: string
  name: string
  unit: string
  group: string
  code?: string
  shelfDays?: number
  translations?: Localized<{ name: string }>
}

const produce = 'Groente & fruit'
const protein = 'Peulvruchten & tofu'
const pantry = 'Voorraadkast'
const spices = 'Kruiden & smaakmakers'

export const ingredients: Ingredient[] = [
  { id: 'tofu', name: 'Stevige tofu', unit: 'g', group: protein, shelfDays: 2 },
  { id: 'chickpeas', name: 'Kikkererwten (uitgelekt)', unit: 'g', group: protein },
  { id: 'lentils', name: 'Linzen, glutenvrij (uitgelekt)', unit: 'g', group: protein },
  { id: 'edamame', name: 'Edamame (diepvries, gedopt)', unit: 'g', group: protein },
  { id: 'spinach', name: 'Spinazie', unit: 'g', group: produce, shelfDays: 2 },
  { id: 'cauliflower', name: 'Bloemkool', unit: 'g', group: produce, shelfDays: 5 },
  { id: 'mushroom', name: 'Champignons', unit: 'g', group: produce, shelfDays: 3 },
  { id: 'onion', name: 'Ui', unit: 'st.', group: produce, shelfDays: 14 },
  { id: 'garlic', name: 'Knoflook', unit: 'teen', group: produce, shelfDays: 14 },
  { id: 'lemon', name: 'Citroen', unit: 'st.', group: produce, shelfDays: 7 },
  { id: 'zucchini', name: 'Courgette', unit: 'g', group: produce, shelfDays: 5 },
  { id: 'carrot', name: 'Wortel', unit: 'g', group: produce, shelfDays: 7 },
  { id: 'paksoi', name: 'Paksoi', unit: 'g', group: produce, shelfDays: 3 },
  { id: 'ginger', name: 'Verse gember', unit: 'cm', group: produce, shelfDays: 7 },
  { id: 'rice', name: 'Zilvervliesrijst (droog)', unit: 'g', group: pantry },
  { id: 'pasta', name: 'Glutenvrije volkorenpasta (droog)', unit: 'g', group: pantry },
  { id: 'coconut', name: 'Light kokosmelk', unit: 'ml', group: pantry },
  { id: 'tomatoes', name: 'Tomatenblokjes', unit: 'g', group: pantry },
  { id: 'paste', name: 'Tomatenpuree', unit: 'g', group: pantry },
  { id: 'cheese', name: 'Vegetarische harde kaas', unit: 'g', group: 'Koeling' },
  { id: 'oil', name: 'Olijfolie', unit: 'ml', group: pantry },
  { id: 'sesame', name: 'Sesamolie', unit: 'ml', group: pantry },
  { id: 'tamari', name: 'Glutenvrije tamari', unit: 'ml', group: pantry },
  { id: 'turmeric', name: 'Kurkuma', unit: 'tl', group: spices },
  { id: 'cumin', name: 'Gemalen komijn', unit: 'tl', group: spices },
  { id: 'curry', name: 'Glutenvrij kerriepoeder', unit: 'tl', group: spices },
  { id: 'italian', name: 'Italiaanse kruiden', unit: 'tl', group: spices },
  { id: 'paprika', name: 'Gerookt paprikapoeder', unit: 'tl', group: spices },
  { id: 'pepper', name: 'Zwarte peper', unit: 'tl', group: spices },
  { id: 'water', name: 'Water', unit: 'ml', group: '' },
]

export const ingredientById = Object.fromEntries(ingredients.map(item => [item.id, item]))
export const allergyTags = ['Glutenvrij', 'Lactosevrij', 'Pindavrij', 'Notenvrij', 'Sojavrij'] as const
export const isAllergyTag = (tag: string) => allergyTags.some(label => label === tag)
export const dietTags = ['Vegetarisch', 'Vegan', ...allergyTags] as const
export const nutritionLabels = { kcal: 'kcal', protein: 'g eiwit', fiber: 'g vezels', carbs: 'g koolhydraten', fat: 'g vet' } as const
export type NutritionValues = Partial<Record<keyof typeof nutritionLabels, number>>

export type Recipe = {
  id: string
  title: string
  subtitle: string
  cuisine: string
  minutes: number
  theme: string
  image?: string
  description: string
  nutrition?: NutritionValues
  source?: string | null
  tags: string[]
  tagIds?: string[]
  translations?: Localized<{ title: string; subtitle: string; cuisine: string; description: string; steps: string[] }>
  amounts: Record<string, number>
  steps: string[]
}

const tags = ['Vegetarisch', 'Glutenvrij', 'Eiwitrijk', 'Snel']
export const recipes: Recipe[] = [
  {
    id: 'curry', title: 'Kikkererwten-spinaziecurry', subtitle: 'Met krokante tofu en zilvervliesrijst',
    cuisine: 'Indiaas geïnspireerd', minutes: 30, theme: 'gold', tags: [...tags, 'Vegan'],
    description: 'Een zachte kokoscurry met bloemkool, spinazie en champignons. De goudbruin gebakken tofu geeft het gerecht een krokante beet.',
    amounts: { tofu: 150, chickpeas: 80, spinach: 100, cauliflower: 80, mushroom: 40, onion: 1/3, garlic: 2/3, coconut: 40, rice: 40, turmeric: 2/3, cumin: 1/3, curry: 1/3, pepper: 1/6, oil: 5, lemon: 1/6, water: 35 },
    steps: [
      'Kook {rice} volgens de verpakking. Snijd {tofu} in blokjes en dep droog.',
      'Verhit {oil:0.5} en bak de tofu goudbruin. Schep uit de pan.',
      'Snipper {onion} en {garlic}. Fruit 2 minuten in {oil:0.5}. Voeg {turmeric}, {cumin}, {curry} en {pepper} toe en bak 30 seconden mee.',
      'Snijd {cauliflower} in kleine roosjes en {mushroom} in plakjes. Doe beide in de pan met {water} en laat 8–10 minuten sudderen.',
      'Voeg {chickpeas} en {coconut} toe. Laat 5 minuten zacht koken. Roer {spinach} er in delen door tot die slinkt.',
      'Schep de tofu terug in de pan. Pers {lemon} uit boven de curry en serveer met de rijst.',
    ],
  },
  {
    id: 'bolognese', title: 'Linzenbolognese', subtitle: 'Met glutenvrije volkorenpasta',
    cuisine: 'Italiaans geïnspireerd', minutes: 30, theme: 'rose', tags: [...tags],
    description: 'Een volle tomatensaus met linzen, fijngesneden groenten en vegetarische harde kaas. Terwijl de saus pruttelt, kook je de pasta.',
    amounts: { lentils: 180, pasta: 65, tomatoes: 100, zucchini: 50, carrot: 50, mushroom: 50, onion: 1/3, garlic: 2/3, cheese: 20, oil: 5, italian: 2/3, paprika: 1/3, paste: 5, pepper: 1/6, water: 35 },
    steps: [
      'Snipper {onion} en {garlic}. Snijd {carrot}, {zucchini} en {mushroom} in kleine blokjes.',
      'Verhit {oil}. Fruit ui en knoflook 2 minuten. Voeg de wortel toe en bak 3 minuten. Bak daarna de courgette en champignons 4 minuten mee.',
      'Roer {paste}, {italian} en {paprika} erdoor. Voeg {tomatoes}, {water} en {lentils} toe en laat 10–12 minuten zacht pruttelen.',
      'Kook ondertussen {pasta} volgens de verpakking.',
      'Breng de saus op smaak met {pepper}. Verdeel over de pasta en rasp {cheese} erboven.',
    ],
  },
  {
    id: 'roerbak', title: 'Tofu-edamame-roerbak', subtitle: 'Met paksoi, gember en tamari',
    cuisine: 'Oost-Aziatisch geïnspireerd', minutes: 25, theme: 'green', tags: [...tags, 'Vegan'],
    description: 'Een knapperige wokmaaltijd met paksoi, wortel en courgette. Gember, citroen en tamari geven de tofu en edamame een frisse, hartige smaak.',
    amounts: { tofu: 150, edamame: 80, paksoi: 85, carrot: 65, mushroom: 45, zucchini: 50, rice: 35, garlic: 2/3, ginger: 2/3, tamari: 15, sesame: 5, lemon: 1/6, pepper: 1/6 },
    steps: [
      'Kook {rice} volgens de verpakking. Bereid {edamame} volgens de verpakking.',
      'Snijd {tofu} in blokjes, dep droog en meng met {tamari:0.3333333333333333}. Bak goudbruin in {sesame:0.5} en schep uit de wok.',
      'Snijd {paksoi}, {carrot}, {mushroom} en {zucchini} in hapklare stukken. Snipper {garlic} en rasp {ginger}.',
      'Verhit {sesame:0.5} en bak wortel en courgette 3 minuten. Voeg champignons, paksoi, knoflook en gember toe en roerbak nog 4–5 minuten.',
      'Doe de edamame en tofu erbij, voeg {tamari:0.6666666666666666} en {pepper} toe en pers {lemon} erboven uit. Verwarm kort en serveer met rijst.',
    ],
  },
]

export const recipeById = Object.fromEntries(recipes.map(recipe => [recipe.id, recipe]))
