import { randomUUID } from 'node:crypto'
import { ingredientById, recipes } from '../domain/catalog.ts'
import { baseTags, nameKey, ingredientCode } from '../domain/terms.ts'
import { InputError, validateRecipe, validateTerm } from './store.mjs'

export function createModeration(store) {
  const { db } = store
  db.exec(`
    CREATE TABLE IF NOT EXISTS public_recipe_edits (id TEXT PRIMARY KEY, recipe TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recipe_publications (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES group_states(id),
      recipe_id TEXT NOT NULL,
      recipe TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
      created INTEGER NOT NULL
    );
  `)
  function canonicalTags(recipe) {
    if (!recipe.tagIds) return recipe.tags
    const terms = new Map([...baseTags, ...store.publicTerms().tags].map(term => [term.id, term.name]))
    return recipe.tagIds.map((id, index) => terms.get(id) ?? recipe.tags[index])
  }
  const publicRecipes = () => [
    ...recipes.map(recipe => {
      const edit = db.prepare('SELECT recipe FROM public_recipe_edits WHERE id = ?').get(recipe.id)
      return edit ? JSON.parse(edit.recipe) : recipe
    }),
    ...db.prepare("SELECT recipe FROM recipe_publications WHERE status = 'approved' ORDER BY created DESC").all().map(row => {
      const { catalogSnapshot, ...recipe } = JSON.parse(row.recipe)
      return { ...recipe, tags: canonicalTags(recipe) }
    }),
  ]
  function codeTaken(code, id) {
    if (Object.hasOwn(ingredientById, code) || /^ingredient-[a-f0-9]{32}$/.test(code)) return true
    return !!db.prepare(`
      SELECT 1 FROM public_terms WHERE kind = 'ingredient' AND id <> ? AND json_extract(data, '$.code') = ?
      UNION ALL
      SELECT 1 FROM group_states g, json_each(g.data, '$.customIngredients') i
      WHERE i.key <> ? AND json_extract(i.value, '$.code') = ?
      LIMIT 1
    `).get(id, code, id, code)
  }

  return {
    publicRecipes,
    async suggestIngredientCode(name, id) {
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof id !== 'string') {
        throw new InputError('Vul eerst een ingrediëntnaam in.')
      }
      const url = new URL('https://api.mymemory.translated.net/get')
      url.search = new URLSearchParams({ q: name.trim(), langpair: 'nl|en' })
      let base
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })
        const result = await response.json()
        const translated = result.responseData?.translatedText
        if (response.ok && Number(result.responseStatus) === 200 && typeof translated === 'string') base = ingredientCode(translated)
      } catch { /* The administrator can enter a code manually. */ }
      if (!base) throw new InputError('Vertalen lukt nu niet. Vul zelf een Engelse code in.')
      let code = base
      for (let suffix = 2; codeTaken(code, id); suffix++) code = base + '-' + suffix
      return { code }
    },
    editIngredient({ groupId, id, name, code }) {
      store.transaction(() => {
        const published = db.prepare("SELECT data FROM public_terms WHERE id = ? AND kind = 'ingredient'").get(id)
        const row = groupId && db.prepare('SELECT data FROM group_states WHERE id = ?').get(groupId)
        const state = row ? JSON.parse(row.data) : undefined
        const previous = published ? JSON.parse(published.data) : state?.customIngredients?.[id]
        if (!previous) throw new InputError('Dit ingrediënt bestaat niet meer.')
        if (typeof code !== 'string' || (code && codeTaken(code, id))) throw new InputError('Deze ingrediëntcode is al bezet of ongeldig.')
        const term = validateTerm({ ...previous, name, code: code || undefined }, 'ingredient')
        if (published) {
          db.prepare('UPDATE public_terms SET data = ? WHERE id = ?').run(JSON.stringify(term), id)
        }
        const linked = db.prepare("SELECT id, data FROM group_states WHERE json_type(data, '$.customIngredients') = 'object'").all()
        const update = db.prepare('UPDATE group_states SET data = ?, revision = revision + 1 WHERE id = ?')
        for (const row of linked) {
          if (!published && row.id !== groupId) continue
          const household = JSON.parse(row.data)
          const existing = household.customIngredients[id]
          if (existing) {
            household.customIngredients[id] = { ...existing, name: term.name, code: term.code }
            update.run(JSON.stringify(household), row.id)
          }
        }
      })
    },
    editPublic(recipe) {
      const terms = store.publicTerms()
      const ingredients = { ...ingredientById, ...Object.fromEntries(terms.ingredients.map(term => [term.id, term])) }
      const tags = Object.fromEntries([...baseTags, ...terms.tags].map(term => [term.id, term]))
      validateRecipe(recipe, ingredients, tags)
      const { id, title, subtitle, cuisine, description, minutes, theme, image, tagIds, amounts, steps, translations, source, nutrition } = recipe
      const labels = tagIds ? tagIds.map(key => tags[key].name) : recipe.tags
      if (labels.some(name => !Object.values(tags).some(tag => nameKey(tag.name) === nameKey(name)))) {
        throw new InputError('Gebruik alleen publieke kenmerken.')
      }
      const data = JSON.stringify({ id, title, subtitle, cuisine, description, minutes, theme, image, tagIds, amounts, steps, translations, source, nutrition, tags: labels })
      if (recipes.some(item => item.id === id)) {
        db.prepare('INSERT INTO public_recipe_edits VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET recipe = excluded.recipe').run(id, data)
      } else if (!db.prepare("UPDATE recipe_publications SET recipe = ? WHERE id = ? AND status = 'approved'").run(data, id).changes) {
        throw new InputError('Dit recept is niet meer publiek.')
      }
      return { recipe: JSON.parse(data) }
    },
    exportCatalog(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new InputError('Selecteer publieke recepten.')
      const selected = publicRecipes().filter(recipe => ids.includes(recipe.id))
      if (selected.length !== new Set(ids).size) throw new InputError('Een geselecteerd recept is niet meer publiek.')
      const terms = store.publicTerms()
      return { format: 'aan-tafel-public-catalog', version: 1, recipes: selected, terms: {
        ingredients: terms.ingredients.filter(term => selected.some(recipe => Object.hasOwn(recipe.amounts, term.id))),
        tags: terms.tags.filter(term => selected.some(recipe => recipe.tagIds?.includes(term.id))),
      } }
    },
    importCatalog(groupId, bundle, ids) {
      if (bundle?.format !== 'aan-tafel-public-catalog' || bundle.version !== 1 ||
          !Array.isArray(bundle.recipes) || bundle.recipes.length > 500 ||
          !Array.isArray(bundle.terms?.ingredients) || !Array.isArray(bundle.terms?.tags) ||
          !Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string')) {
        throw new InputError('Kies een geldig catalogusbestand en selecteer recepten.')
      }
      const selected = bundle.recipes.filter(recipe => ids.includes(recipe?.id))
      if (selected.length !== new Set(ids).size || new Set(selected.map(recipe => recipe.id)).size !== selected.length) {
        throw new InputError('Ongeldige receptselectie.')
      }
      return store.transaction(() => {
        const known = db.prepare('SELECT 1 FROM recipe_publications WHERE id = ?')
        const additions = selected.filter(recipe => !recipes.some(starter => starter.id === recipe.id) && !known.get(recipe.id))
        const terms = store.publicTerms()
        const ingredients = { ...ingredientById, ...Object.fromEntries(terms.ingredients.map(term => [term.id, term])) }
        const tags = Object.fromEntries([...baseTags, ...terms.tags].map(term => [term.id, term]))
        const insertTerm = db.prepare('INSERT INTO public_terms VALUES (?, ?, ?)')
        for (const [kind, entries, target] of [['ingredient', bundle.terms.ingredients, ingredients], ['tag', bundle.terms.tags, tags]]) {
          for (const entry of entries) {
            if (!entry || !additions.some(recipe => kind === 'ingredient'
              ? Object.hasOwn(recipe.amounts ?? {}, entry.id)
              : Array.isArray(recipe.tagIds) && recipe.tagIds.includes(entry.id))) continue
            const term = validateTerm(entry, kind)
            if (Object.hasOwn(target, term.id)) {
              if (target[term.id].unit !== term.unit || target[term.id].name !== term.name) throw new InputError('Een term botst met de bestaande catalogus.')
              continue
            }
            insertTerm.run(term.id, kind, JSON.stringify(term))
            target[term.id] = term
          }
        }
        const insert = db.prepare("INSERT INTO recipe_publications VALUES (?, ?, ?, ?, 'approved', ?)")
        for (const recipe of additions) {
          validateRecipe(recipe, ingredients, tags)
          const { id, title, subtitle, cuisine, description, minutes, theme, image, tagIds, amounts, steps, translations, source, nutrition } = recipe
          const labels = tagIds ? tagIds.map(key => tags[key].name) : recipe.tags
          insert.run(id, groupId, id, JSON.stringify({ id, title, subtitle, cuisine, description, minutes, theme, image, tagIds, amounts, steps, translations, source, nutrition, tags: labels }), Date.now())
        }
        return { message: additions.length + ' geïmporteerd, ' + (selected.length - additions.length) + ' overgeslagen (al aanwezig).' }
      })
    },
    pendingTerms() {
      return db.prepare(`
        SELECT 'ingredient' AS kind, i.key AS id, i.value AS data, g.id AS groupId, json_extract(g.data, '$.household.name') AS groupName
        FROM group_states g, json_each(g.data, '$.customIngredients') i
        WHERE NOT EXISTS (SELECT 1 FROM public_terms p WHERE p.id = i.key)
        UNION ALL
        SELECT 'tag', t.key, t.value, g.id, json_extract(g.data, '$.household.name')
        FROM group_states g, json_each(g.data, '$.customTags') t
        WHERE NOT EXISTS (SELECT 1 FROM public_terms p WHERE p.id = t.key)
      `).all().map(({ data, ...row }) => ({ ...row, ...JSON.parse(data) }))
    },
    publishTerm({ groupId, id, kind, name, code }) {
      if (typeof groupId !== 'string' || typeof id !== 'string' || !['ingredient', 'tag'].includes(kind)) {
        throw new InputError('Kies een ingrediënt of kenmerk.')
      }
      const row = db.prepare('SELECT data FROM group_states WHERE id = ?').get(groupId)
      const state = row && JSON.parse(row.data)
      const terms = kind === 'ingredient' ? state?.customIngredients : state?.customTags
      if (!Object.hasOwn(terms ?? {}, id)) throw new InputError('Deze term bestaat niet meer.')
      const term = validateTerm({ ...terms[id], name: name ?? terms[id].name,
        code: code === undefined ? terms[id].code : code === '' ? undefined : code }, kind)
      if (term.code && codeTaken(term.code, id)) throw new InputError('Deze ingrediëntcode is al bezet.')
      if (!db.prepare('INSERT OR IGNORE INTO public_terms VALUES (?, ?, ?)').run(id, kind, JSON.stringify(term)).changes) {
        throw new InputError('Deze term is al gepubliceerd.')
      }
    },
    copy(groupId, { id, copyId }) {
      const recipe = publicRecipes().find(item => item.id === id)
      if (!recipe || typeof copyId !== 'string' || !/^[a-f0-9]{32}$/.test(copyId)) {
        throw new InputError('Dit publieke recept is niet beschikbaar.')
      }
      const { state } = store.read(groupId)
      if (!Object.hasOwn(state.recipeEdits ?? {}, copyId)) {
        store.write(groupId, { type: 'saveRecipe', recipe: { ...recipe, id: copyId } })
      }
    },
    submit(groupId, id) {
      const { state } = store.read(groupId)
      if (typeof id !== 'string' || !Object.hasOwn(state.recipeEdits ?? {}, id)) {
        throw new InputError('Kies een privérecept uit je groep.')
      }
      const pending = db.prepare("SELECT 1 FROM recipe_publications WHERE group_id = ? AND recipe_id = ? AND status = 'pending'")
      if (pending.get(groupId, id)) throw new InputError('Dit recept wacht al op beoordeling.')
      const publicationId = randomUUID()
      const recipe = state.recipeEdits[id]
      const catalogSnapshot = {
        ingredients: Object.fromEntries(Object.keys(recipe.amounts).filter(key => Object.hasOwn(state.customIngredients ?? {}, key))
          .map(key => [key, state.customIngredients[key]])),
      }
      db.prepare("INSERT INTO recipe_publications VALUES (?, ?, ?, ?, 'pending', ?)")
        .run(publicationId, groupId, id, JSON.stringify({ ...recipe, id: publicationId, catalogSnapshot }), Date.now())
    },
    list() {
      return db.prepare(`
        SELECT p.id, p.status, p.created, json_extract(p.recipe, '$.title') AS title,
               json_extract(g.data, '$.household.name') AS groupName
        FROM recipe_publications p JOIN group_states g ON g.id = p.group_id
        ORDER BY p.status = 'pending' DESC, p.created DESC
      `).all()
    },
    review(id) {
      const row = db.prepare('SELECT recipe FROM recipe_publications WHERE id = ?').get(id)
      if (!row) throw new InputError('Publicatie bestaat niet.')
      const { catalogSnapshot, ...recipe } = JSON.parse(row.recipe)
      return { recipe: { ...recipe, tags: canonicalTags(recipe) }, ingredients: { ...ingredientById, ...Object.fromEntries(store.publicTerms().ingredients.map(term => [term.id, term])), ...catalogSnapshot?.ingredients } }
    },
    decide({ id, status }) {
      if (typeof id !== 'string') throw new InputError('Kies een publicatie.')
      if (status === 'approved') {
        const { recipe, ingredients } = this.review(id)
        const custom = store.publicTerms()
        const publicIngredients = { ...ingredientById, ...Object.fromEntries(custom.ingredients.map(term => [term.id, term])) }
        const publicTags = [...baseTags, ...custom.tags]
        const missingIngredients = Object.keys(recipe.amounts).some(key =>
          !Object.hasOwn(publicIngredients, key) || ingredients[key]?.unit !== publicIngredients[key].unit)
        const missingTags = recipe.tagIds
          ? recipe.tagIds.some(key => !publicTags.some(tag => tag.id === key))
          : recipe.tags.some(name => !publicTags.some(tag => nameKey(tag.name) === nameKey(name)))
        if (missingIngredients || missingTags) {
          throw new InputError('Publiceer eerst de privé-ingrediënten en kenmerken van dit recept. Koppel oude kenmerken zo nodig opnieuw in de recepteditor.')
        }
      }
      const before = { approved: 'pending', rejected: 'pending', archived: 'approved' }[status]
      if (!['approved', 'rejected', 'archived'].includes(status) || !db.prepare(
        'UPDATE recipe_publications SET status = ? WHERE id = ? AND status = ?',
      ).run(status, id, before).changes) throw new InputError('De publicatiestatus is inmiddels gewijzigd.')
    },
  }
}
