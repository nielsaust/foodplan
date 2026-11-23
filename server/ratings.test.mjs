import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './store.mjs'
import { createAuth } from './auth.mjs'
import { createRatings } from './ratings.mjs'
import { recipes } from '../domain/catalog.ts'

function setup(t) {
  const store = openStore(':memory:')
  createAuth(store, async () => {})
  const ratings = createRatings(store)
  for (const groupId of ['group-a', 'group-b']) {
    store.createGroup(groupId, groupId)
    for (const id of ['alice', 'bob']) store.addGroupPerson(groupId, { id, name: id, factor: 1 })
    store.write(groupId, { type: 'saveRecipe', recipe: { ...recipes[0], id: 'private-meal' } })
  }
  t.after(() => store.db.close())
  const account = (groupId = 'group-a', personId = 'alice') => ({ groupId, personId })
  const vote = (who, score, privateRecipe = false, recipeId = privateRecipe ? 'private-meal' : 'curry') => ratings.vote(who, { recipeId, score, privateRecipe })
  return { store, ratings, account, vote }
}

test('public average includes all households, repeated votes update, individuals stay private', t => {
  const { store, ratings, account, vote } = setup(t)
  const before = store.read('group-a').revision
  vote(account(), 5)
  vote(account('group-a', 'bob'), 3)
  vote(account('group-b'), 1)
  assert.deepEqual(ratings.snapshot('group-a').public.curry, { total: 9, count: 3, household: { alice: 5, bob: 3 } })
  assert.deepEqual(ratings.snapshot('group-b').public.curry.household, { alice: 1 })
  vote(account(), 2)
  assert.deepEqual(ratings.snapshot('group-a').public.curry, { total: 6, count: 3, household: { alice: 2, bob: 3 } })
  assert.equal(store.read('group-a').revision, before + 3)
})

test('private votes are isolated even when recipe and person IDs match across households', t => {
  const { ratings, account, vote } = setup(t)
  vote(account(), 4, true)
  vote(account('group-b'), 1, true)
  assert.deepEqual(ratings.snapshot('group-a').private['private-meal'], { total: 4, count: 1, household: { alice: 4 } })
  assert.deepEqual(ratings.snapshot('group-b').private['private-meal'], { total: 1, count: 1, household: { alice: 1 } })
  assert.deepEqual(ratings.snapshot('group-a').public, {})
})

test('invalid scores, absent members, foreign recipes and archived public dishes are rejected atomically', t => {
  const { store, ratings, account, vote } = setup(t)
  const before = store.read('group-a').revision
  for (const score of [0, 6, -1, 2.5, '5', null, undefined]) assert.throws(() => vote(account(), score), /sterren/)
  assert.throws(() => vote(account('group-a', 'outsider'), 4), /huisgenootprofiel/)
  assert.throws(() => vote(account(), 4, true, 'curry'), /recept/)
  assert.throws(() => vote(account(), 4, false, 'private-meal'), /recept/)
  assert.throws(() => vote(account(), 4, false, 'missing'), /recept/)
  store.db.prepare("UPDATE recipe_publications SET status = 'archived' WHERE id = 'curry'").run()
  assert.throws(() => vote(account(), 4), /recept/)
  assert.deepEqual(ratings.snapshot('group-a'), { public: {}, private: {} })
  assert.equal(store.read('group-a').revision, before)
})

test('removed housemates stop counting and deleted private recipes lose their votes', t => {
  const { store, ratings, account, vote } = setup(t)
  vote(account(), 5)
  vote(account(), 3, true)
  store.write('group-a', { type: 'deleteRecipe', id: 'private-meal' })
  ratings.prune('group-a')
  assert.deepEqual(ratings.snapshot('group-a').private, {})
  store.write('group-a', { type: 'removePerson', id: 'alice' })
  assert.deepEqual(ratings.snapshot('group-a').public, {})
  ratings.prune('group-a')
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM recipe_ratings').get().n, 0)
})
