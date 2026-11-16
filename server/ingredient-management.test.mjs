import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore, validateTerm } from './store.mjs'
import { createAuth } from './auth.mjs'
import { householdIngredients, shoppingItems } from '../domain/planning.ts'

const sourceId = 'ingredient-' + 'a'.repeat(32)
const targetId = 'ingredient-' + 'b'.repeat(32)
const tagId = 'tag-' + 'c'.repeat(32)
function setup() {
  const store = openStore(':memory:')
  const auth = createAuth(store, async () => {})
  const moderation = auth.moderation
  const management = moderation.ingredientManagement
  store.createGroup('group-a', 'A')
  store.createGroup('group-b', 'B')
  const source = { id: sourceId, name: 'Eieren', unit: 'st.', group: 'Overige ingrediënten' }
  const target = { id: targetId, name: 'Ei', unit: 'st.', group: 'Koeling' }
  function seed(groupId = 'group-a', sourceTerm = source, targetTerm = target) {
    store.db.prepare("INSERT OR REPLACE INTO public_terms VALUES (?, 'ingredient', ?)").run(targetTerm.id, JSON.stringify(targetTerm))
    const recipe = { id: 'recipe-' + groupId, title: 'Test', subtitle: '', cuisine: 'Onbekend', description: 'Testrecept', minutes: 10, theme: 'green', tags: [],
      amounts: { [sourceTerm.id]: 2, [targetTerm.id]: 1 }, steps: [`Bak {${sourceTerm.id}:0.5} en {${targetTerm.id}}.`],
      translations: { en: { steps: [`Cook {${sourceTerm.id}}.`] } } }
    store.write(groupId, { type: 'saveRecipe', recipe, terms: { ingredients: [sourceTerm], tags: [] } })
    return recipe
  }
  return { store, auth, moderation, management, source, target, seed }
}

test('private merge combines quantities, preserves fractions and translations and updates pending snapshots', () => {
  const { store, moderation, management, seed } = setup()
  const recipe = seed()
  const other = seed('group-b')
  const beforeB = store.read('group-b')
  moderation.submit('group-a', recipe.id)
  const publication = moderation.list().find(item => item.status === 'pending')
  management.merge({ id: sourceId, groupId: 'group-a', targetId })
  const state = store.read('group-a').state
  const edited = state.recipeEdits[recipe.id]
  assert.deepEqual(edited.amounts, { [targetId]: 3 })
  assert.equal(state.customIngredients[sourceId], undefined)
  assert.ok(!edited.steps.join('').includes(sourceId))
  const factors = [...edited.steps[0].matchAll(/:([\d.]+)\}/g)].map(match => Number(match[1]))
  assert.equal(factors.length, 2)
  assert.ok(factors.every(factor => Math.abs(factor - 1 / 3) < 1e-12))
  assert.ok(edited.translations.en.steps[0].includes(targetId + ':0.666666666666667'))
  const review = moderation.review(publication.id)
  assert.deepEqual(review.recipe.amounts, { [targetId]: 3 })
  assert.equal(review.ingredients[sourceId], undefined)
  assert.equal(review.ingredients[targetId].name, 'Ei')
  assert.deepEqual(store.read('group-b'), beforeB)
  assert.equal(store.read('group-b').state.recipeEdits[other.id].amounts[sourceId], 2)
  assert.throws(() => store.write('group-a', { type: 'saveRecipe', recipe }), /samengevoegd/)
  store.db.close()
})

test('public merge rewrites all households and all publication statuses', () => {
  const { store, moderation, management, source, seed } = setup()
  const a = seed()
  seed('group-b')
  moderation.publishTerm({ groupId: 'group-a', id: sourceId, kind: 'ingredient' })
  moderation.submit('group-a', a.id)
  const pending = moderation.list().find(item => item.status === 'pending')
  moderation.decide({ id: pending.id, status: 'approved' })
  management.merge({ id: source.id, targetId })
  assert.equal(store.publicTerms().ingredients.some(item => item.id === sourceId), false)
  for (const group of ['group-a', 'group-b']) assert.equal(Object.values(store.read(group).state.recipeEdits)[0].amounts[sourceId], undefined)
  assert.deepEqual(moderation.review(pending.id).recipe.amounts, { [targetId]: 3 })
  assert.ok(management.retiredIds().includes(sourceId))
  store.db.close()
})

test('merge converts compatible units and preserves shopping quantities and purchase keys', () => {
  const { store, management, seed } = setup()
  const source = { id: sourceId, name: 'Water in liter', unit: 'l', group: 'Voorraadkast' }
  const target = { id: targetId, name: 'Water in milliliter', unit: 'ml', group: 'Voorraadkast' }
  const recipe = seed('group-a', source, target)
  store.write('group-a', { type: 'person', id: 'person', name: 'Persoon', factor: 1 })
  store.write('group-a', { type: 'meal', date: '2026-11-16', recipeId: recipe.id })
  const before = store.read('group-a').state
  before.purchased = [JSON.stringify([sourceId, '2026-11-16', 2])]
  before.checked = [JSON.stringify([sourceId, [['2026-11-16', 2]]])]
  store.db.prepare('UPDATE group_states SET data = ? WHERE id = ?').run(JSON.stringify(before), 'group-a')
  management.merge({ id: sourceId, groupId: 'group-a', targetId })
  const snapshot = store.withCatalog(store.read('group-a').state)
  assert.equal(snapshot.recipeEdits[recipe.id].amounts[targetId], 2001)
  const items = shoppingItems(snapshot, '2026-11-16', 1)
  assert.equal(items.length, 1)
  assert.equal(items[0].total, 2001)
  assert.deepEqual(snapshot.purchased, [JSON.stringify([targetId, '2026-11-16', 2000])])
  assert.deepEqual(snapshot.checked, [JSON.stringify([targetId, [['2026-11-16', 2000]]])])
  store.db.close()
})

test('incompatible units, missing targets and cross-household private targets fail atomically', () => {
  const { store, management, seed } = setup()
  seed()
  const before = store.read('group-a')
  for (const options of [{ targetId: 'missing' }, { targetId: 'carrot' }, { targetId: sourceId }]) {
    assert.throws(() => management.merge({ id: sourceId, groupId: 'group-a', ...options }))
    assert.deepEqual(store.read('group-a'), before)
  }
  assert.throws(() => management.merge({ id: sourceId, groupId: 'group-b', targetId }))
  store.db.close()
})

test('merging builtin ingredients retires them in pickers and migrates published recipes', () => {
  const { store, management, moderation } = setup()
  const result = management.merge({ id: 'oil', targetId: 'sesame' })
  assert.ok(result.message)
  const state = store.withCatalog(store.read(store.legacyGroupId).state)
  assert.equal(householdIngredients(state).oil, undefined)
  assert.ok(state.retiredIngredientIds.includes('oil'))
  for (const recipe of moderation.publicRecipes()) assert.equal(recipe.amounts.oil, undefined)
  store.db.close()
})

test('categories persist through validation and public/private editing and publication', () => {
  const { store, management, moderation, seed } = setup()
  seed()
  management.saveCategory({ name: 'Eieren en zuivel' })
  moderation.editIngredient({ groupId: 'group-a', id: sourceId, name: 'Eieren', code: '', group: 'Eieren en zuivel' })
  assert.equal(store.read('group-a').state.customIngredients[sourceId].group, 'Eieren en zuivel')
  moderation.publishTerm({ groupId: 'group-a', id: sourceId, kind: 'ingredient', group: 'Koeling' })
  assert.equal(store.publicTerms().ingredients.find(item => item.id === sourceId).group, 'Koeling')
  assert.equal(store.read('group-a').state.customIngredients[sourceId].group, 'Koeling')
  assert.equal(validateTerm({ id: sourceId, name: 'Eieren', unit: 'st.', group: 'Koeling' }, 'ingredient').group, 'Koeling')
  assert.throws(() => moderation.editIngredient({ id: sourceId, name: 'Eieren', code: '', group: 'Onbekend' }), /categorie/)
  store.db.close()
})

test('category rename/delete migrate builtin overrides, household copies and review snapshots', () => {
  const { store, management, moderation, seed } = setup()
  const recipe = seed()
  moderation.submit('group-a', recipe.id)
  const pending = moderation.list().find(item => item.status === 'pending')
  management.saveCategory({ previous: 'Overige ingrediënten', name: 'Overige ingrediënten' })
  management.saveCategory({ previous: 'Groente & fruit', name: 'Groenten' })
  assert.ok(!management.categories().some(item => item.name === 'Groente & fruit'))
  assert.equal(householdIngredients(store.withCatalog(store.read('group-a').state)).carrot.group, 'Groenten')
  management.saveCategory({ previous: 'Koeling', name: 'Zuivel' })
  assert.equal(moderation.review(pending.id).ingredients[targetId].group, 'Zuivel')
  assert.equal(store.read('group-a').state.customIngredients[targetId].group, 'Zuivel')
  management.deleteCategory({ name: 'Zuivel', replacement: 'Voorraadkast' })
  assert.ok(!management.categories().some(item => item.name === 'Zuivel'))
  assert.equal(store.publicTerms().ingredients.find(item => item.id === targetId).group, 'Voorraadkast')
  assert.equal(moderation.review(pending.id).ingredients[targetId].group, 'Voorraadkast')
  assert.throws(() => management.deleteCategory({ name: 'Overige ingrediënten', replacement: 'Voorraadkast' }))
  assert.throws(() => management.saveCategory({ name: 'voorraadkast' }))
  assert.throws(() => management.deleteCategory({ name: 'Groenten', replacement: 'missing' }))
  store.db.close()
})

test('merge rolls back all mutations on a late database failure', () => {
  const { store, management, seed } = setup()
  seed()
  const before = store.read('group-a')
  store.db.exec("CREATE TRIGGER reject_merge BEFORE INSERT ON ingredient_merges BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
  assert.throws(() => management.merge({ id: sourceId, groupId: 'group-a', targetId }), /test rollback/)
  assert.deepEqual(store.read('group-a'), before)
  assert.deepEqual(management.retiredIds(), [])
  store.db.close()
})

test('management endpoints require a superuser', async () => {
  const { store, auth } = setup()
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: {} }
  for (const route of ['ingredient-merge', 'category-save', 'category-delete']) {
    await assert.rejects(auth.handle(route, {}, request, undefined), { status: 401 })
    await assert.rejects(auth.handle(route, {}, request, { id: 'member', groupId: 'group-a', superuser: false }), { status: 403 })
  }
  store.db.close()
})

test('pending recipes with private tags remain valid through merging', () => {
  const { store, moderation, management, seed } = setup()
  const original = seed()
  const recipe = { ...original, tagIds: [tagId], tags: ['Huisfavoriet'] }
  store.write('group-a', { type: 'saveRecipe', recipe, terms: { ingredients: [], tags: [{ id: tagId, name: 'Huisfavoriet' }] } })
  moderation.submit('group-a', recipe.id)
  management.merge({ id: sourceId, groupId: 'group-a', targetId })
  const pending = moderation.list().find(item => item.status === 'pending')
  assert.deepEqual(moderation.review(pending.id).recipe.tagIds, [tagId])
  store.db.close()
})

test('bulk save updates selected ingredients atomically without publishing them', async () => {
  const { store, auth, seed } = setup()
  seed()
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: {} }
  const current = { superuser: true }
  const first = { id: sourceId, groupId: 'group-a', name: 'Verse eieren', code: '', group: 'Koeling' }
  const before = store.read('group-a')
  await assert.rejects(auth.handle('ingredients-save', { ingredients: [first, { id: 'missing', name: 'Missing', code: '' }] }, request, current))
  assert.deepEqual(store.read('group-a'), before)
  await auth.handle('ingredients-save', { ingredients: [first, { id: targetId, name: 'Ei', code: '', group: 'Koeling' }] }, request, current)
  assert.equal(store.read('group-a').state.customIngredients[sourceId].name, 'Verse eieren')
  assert.equal(store.publicTerms().ingredients.some(item => item.id === sourceId), false)
  await assert.rejects(auth.handle('ingredients-save', { ingredients: [first] }, request, { superuser: false }), { status: 403 })
  store.db.close()
})

test('bulk category assignment preserves names and codes, updates both scopes and rolls back on error', () => {
  const { store, moderation, seed } = setup()
  seed()
  const before = store.read('group-a')
  assert.throws(() => moderation.assignCategory({ ingredients: [{ id: sourceId, groupId: 'group-a' }, { id: 'missing' }], group: 'Voorraadkast' }))
  assert.deepEqual(store.read('group-a'), before)
  moderation.assignCategory({ ingredients: [{ id: sourceId, groupId: 'group-a' }, { id: targetId }], group: 'Voorraadkast' })
  const term = store.read('group-a').state.customIngredients[sourceId]
  assert.equal(term.group, 'Voorraadkast')
  assert.equal(term.name, 'Eieren')
  assert.equal(store.publicTerms().ingredients.find(item => item.id === targetId).group, 'Voorraadkast')
  assert.equal(store.publicTerms().ingredients.some(item => item.id === sourceId), false)
  assert.throws(() => moderation.assignCategory({ ingredients: [{ id: targetId }], group: 'missing' }))
  store.db.close()
})
