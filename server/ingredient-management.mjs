import { ingredientById } from '../domain/catalog.ts'
import { baseTags, nameKey } from '../domain/terms.ts'
import { quantityInUnit } from '../domain/units.ts'
import { InputError, validateRecipe } from './store.mjs'

const fallback = 'Overige ingrediënten'
const own = (value, key) => Object.hasOwn(value ?? {}, key)
const label = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new InputError('Vul een categorienaam van 1 tot 80 tekens in.')
  return value.trim()
}

export function createIngredientManagement(store) {
  const { db } = store
  db.exec(`CREATE TABLE IF NOT EXISTS ingredient_categories (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS ingredient_merges (source_id TEXT NOT NULL, group_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY(source_id, group_id));`)
  const groups = () => db.prepare('SELECT id, data FROM group_states').all().map(row => ({ id: row.id, state: JSON.parse(row.data) }))
  const publicIngredients = () => ({ ...ingredientById, ...Object.fromEntries(store.publicTerms().ingredients.map(item => [item.id, item])) })
  const retiredIds = () => db.prepare("SELECT source_id FROM ingredient_merges WHERE group_id = ''").all().map(row => row.source_id)
  const saveGroup = (id, state) => db.prepare('UPDATE group_states SET data = ?, revision = revision + 1 WHERE id = ?').run(JSON.stringify(state), id)
  function categories() {
    const retired = new Set(retiredIds())
    const ingredients = [...Object.values(publicIngredients()).filter(item => !retired.has(item.id)), ...groups().flatMap(row => Object.values(row.state.customIngredients ?? {}))]
    const names = new Set([fallback, ...ingredients.map(item => item.group).filter(Boolean), ...db.prepare('SELECT name FROM ingredient_categories').all().map(row => row.name)])
    return [...names].sort((a, b) => a.localeCompare(b, 'nl')).map(name => ({ name,
      count: new Set(ingredients.filter(item => item.group === name).map(item => item.id)).size,
    }))
  }
  const putPublic = term => db.prepare("INSERT INTO public_terms VALUES (?, 'ingredient', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(term.id, JSON.stringify(term))
  function moveCategory(from, to) {
    const retired = new Set(retiredIds())
    for (const term of Object.values(publicIngredients())) {
      if (!retired.has(term.id) && term.group === from) putPublic({ ...term, group: to })
    }
    for (const { id, state } of groups()) {
      let changed = false
      for (const term of Object.values(state.customIngredients ?? {})) {
        if (term.group === from) { term.group = to; changed = true }
      }
      if (changed) saveGroup(id, state)
    }
    // Review snapshots must retain the current category when later published.
    for (const row of db.prepare('SELECT id, recipe FROM recipe_publications').all()) {
      const recipe = JSON.parse(row.recipe)
      let changed = false
      for (const term of Object.values(recipe.catalogSnapshot?.ingredients ?? {})) {
        if (term.group === from) { term.group = to; changed = true }
      }
      if (changed) db.prepare('UPDATE recipe_publications SET recipe = ? WHERE id = ?').run(JSON.stringify(recipe), row.id)
    }
  }
  function requireCategory(name) {
    if (name !== '' && !categories().some(item => item.name === name)) throw new InputError('Kies een bestaande categorie.')
  }
  function merge({ id, groupId, targetId }) {
    return store.transaction(() => {
      if (typeof id !== 'string' || typeof targetId !== 'string' || id === targetId || (groupId !== undefined && typeof groupId !== 'string')) throw new InputError('Kies twee verschillende ingrediënten.')
      const publicTerms = publicIngredients()
      const retired = new Set(retiredIds())
      const household = groupId ? groups().find(row => row.id === groupId)?.state : undefined
      const sourcePublic = own(publicTerms, id) && !retired.has(id)
      const source = sourcePublic ? publicTerms[id] : household?.customIngredients?.[id]
      const target = !retired.has(targetId) ? publicTerms[targetId] ?? household?.customIngredients?.[targetId] : undefined
      if (!source || !target || (sourcePublic && !own(publicTerms, targetId))) throw new InputError('Kies een bestaand ingrediënt. Een publiek ingrediënt kan alleen worden vervangen door een publiek ingrediënt.')
      const ratio = quantityInUnit(1, source.unit, target.unit)
      if (ratio === undefined) throw new InputError(`Kan ${source.unit} niet automatisch omrekenen naar ${target.unit}. Kies een ingrediënt met dezelfde of een omrekenbare eenheid.`)
      let recipesChanged = 0
      function rewrite(recipe, ingredients, privateTags = {}) {
        if (!own(recipe.amounts, id)) return false
        const sourceAmount = recipe.amounts[id] * ratio
        const targetAmount = recipe.amounts[targetId] ?? 0
        const total = sourceAmount + targetAmount
        if (!Number.isFinite(total) || total <= 0 || total > 10000) throw new InputError('De samengevoegde hoeveelheid per portie is te groot.')
        delete recipe.amounts[id]
        recipe.amounts[targetId] = total
        function step(text) {
          return text.replace(/\{([a-z0-9-]+)(?::(\d+(?:\.\d+)?))?\}/g, (match, key, fraction) => {
            if (key !== id && key !== targetId) return match
            const part = key === id ? sourceAmount : targetAmount
            const factor = part / total * (fraction === undefined ? 1 : Number(fraction))
            const suffix = factor === 1 ? '' : ':' + factor.toFixed(15).replace(/0+$/, '').replace(/\.$/, '')
            return '{' + targetId + suffix + '}'
          })
        }
        recipe.steps = recipe.steps.map(step)
        for (const translation of Object.values(recipe.translations ?? {})) if (translation.steps) translation.steps = translation.steps.map(step)
        if (recipe.catalogSnapshot?.ingredients) {
          delete recipe.catalogSnapshot.ingredients[id]
          recipe.catalogSnapshot.ingredients[targetId] = target
        }
        const tags = Object.fromEntries([...baseTags, ...store.publicTerms().tags].map(term => [term.id, term]))
        for (const tag of Object.values(privateTags)) tags[tag.id] = tag
        validateRecipe(recipe, { ...publicTerms, ...ingredients, [targetId]: target }, tags)
        recipesChanged++
        return true
      }
      function rewriteKey(value) {
        try {
          const key = JSON.parse(value)
          if (key[0] !== id) return value
          key[0] = targetId
          if (Array.isArray(key[1])) key[1] = key[1].map(([date, amount]) => [date, amount * ratio])
          else key[2] *= ratio
          return JSON.stringify(key)
        } catch { return value }
      }
      for (const { id: householdId, state } of groups()) {
        if (!sourcePublic && householdId !== groupId) continue
        let changed = false
        for (const recipe of Object.values(state.recipeEdits ?? {})) {
          if (rewrite(recipe, state.customIngredients ?? {}, state.customTags)) changed = true
        }
        if (own(state.customIngredients, id)) { delete state.customIngredients[id]; changed = true }
        if (!own(ingredientById, targetId) && (changed || Object.values(state.recipeEdits ?? {}).some(recipe => own(recipe.amounts, targetId)))) {
          state.customIngredients = { ...state.customIngredients, [targetId]: target }
        }
        const checked = state.checked.map(rewriteKey)
        const purchased = (state.purchased ?? []).map(rewriteKey)
        if (JSON.stringify(checked) !== JSON.stringify(state.checked) || JSON.stringify(purchased) !== JSON.stringify(state.purchased ?? [])) changed = true
        state.checked = [...new Set(checked)]
        state.purchased = [...new Set(purchased)]
        if (changed) saveGroup(householdId, state)
      }
      for (const row of db.prepare('SELECT id, group_id, recipe FROM recipe_publications').all()) {
        if (!sourcePublic && row.group_id !== groupId) continue
        const recipe = JSON.parse(row.recipe)
        const ownerState = groups().find(group => group.id === row.group_id)?.state
        if (rewrite(recipe, { ...ownerState?.customIngredients, ...recipe.catalogSnapshot?.ingredients }, ownerState?.customTags)) {
          db.prepare('UPDATE recipe_publications SET recipe = ? WHERE id = ?').run(JSON.stringify(recipe), row.id)
        }
      }
      if (sourcePublic) db.prepare("DELETE FROM public_terms WHERE kind = 'ingredient' AND id = ?").run(id)
      db.prepare('INSERT INTO ingredient_merges VALUES (?, ?, ?)').run(id, sourcePublic ? '' : groupId, targetId)
      return { message: `${source.name} vervangen door ${target.name}. ${recipesChanged} receptversies bijgewerkt.` }
    })
  }
  return { categories, retiredIds, requireCategory, merge,
    saveCategory({ name, previous }) {
      return store.transaction(() => {
        name = label(name)
        if (previous !== undefined && (typeof previous !== 'string' || !categories().some(item => item.name === previous))) throw new InputError('Deze categorie bestaat niet meer.')
        if (previous === fallback && name !== fallback) throw new InputError('De opvangcategorie kan niet worden hernoemd.')
        if (categories().some(item => item.name !== previous && nameKey(item.name) === nameKey(name))) throw new InputError('Deze categorie bestaat al.')
        if (previous && previous !== name) { moveCategory(previous, name); db.prepare('DELETE FROM ingredient_categories WHERE name = ?').run(previous) }
        db.prepare('INSERT OR IGNORE INTO ingredient_categories VALUES (?)').run(name)
        return { message: 'Categorie opgeslagen.' }
      })
    },
    deleteCategory({ name, replacement }) {
      return store.transaction(() => {
        if (name === fallback) throw new InputError('De opvangcategorie kan niet worden verwijderd.')
        if (!categories().some(item => item.name === name) || !replacement || replacement === name) throw new InputError('Kies een andere categorie voor de ingrediënten.')
        requireCategory(replacement)
        moveCategory(name, replacement)
        db.prepare('DELETE FROM ingredient_categories WHERE name = ?').run(name)
        return { message: 'Categorie verwijderd en ingrediënten verplaatst.' }
      })
    },
  }
}
