import { ingredients, recipes, allergyTags } from './catalog.ts'
import type { Ingredient } from './catalog.ts'

export type Localized<T> = Partial<Record<string, Partial<T>>>
export type Tag = { id: string; name: string; translations?: Localized<{ name: string }> }

export const baseTags: Tag[] = [...new Set([...recipes.flatMap(recipe => recipe.tags), ...allergyTags])]
  .map(name => ({ id: 'tag-' + name.toLowerCase(), name }))

export const emptyTerms: Terms = { ingredients: [], tags: [] }
export type Terms = { ingredients: Ingredient[]; tags: Tag[] }
export const publicBaseTerms = { ingredients, tags: baseTags }

export function nameKey(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('nl').trim().replace(/\s+/g, ' ')
}

export function ingredientCode(name: string) {
  return nameKey(name).replace(/[^a-z0-9]+/g, '-').slice(0, 48).replace(/^-+|-+$/g, '')
}
