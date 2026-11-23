import { InputError } from './store.mjs'

export function createRatings(store) {
  const { db } = store
  db.exec(`CREATE TABLE IF NOT EXISTS recipe_ratings (
    group_id TEXT NOT NULL REFERENCES group_states(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL,
    recipe_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('public', 'private')),
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    PRIMARY KEY (group_id, person_id, recipe_id, scope)
  ); CREATE INDEX IF NOT EXISTS recipe_ratings_recipe ON recipe_ratings(scope, recipe_id);`)

  return {
    vote(account, action) {
      return store.transaction(() => {
        const state = store.withCatalog(store.read(account.groupId).state)
        const scope = action.privateRecipe === true ? 'private' : 'public'
        const catalog = scope === 'private' ? state.recipeEdits : state.publicRecipes
        if (typeof action.recipeId !== 'string' || !Object.hasOwn(catalog ?? {}, action.recipeId) ||
            (scope === 'public' && state.archivedRecipeIds?.includes(action.recipeId))) {
          throw new InputError('Dit recept kan niet worden beoordeeld.')
        }
        if (!state.people.some(person => person.id === account.personId)) throw new InputError('Je account heeft geen huisgenootprofiel.')
        if (!Number.isInteger(action.score) || action.score < 1 || action.score > 5) throw new InputError('Kies één tot vijf sterren.')
        db.prepare(`INSERT INTO recipe_ratings VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(group_id, person_id, recipe_id, scope) DO UPDATE SET score = excluded.score`)
          .run(account.groupId, account.personId, action.recipeId, scope, action.score)
        db.prepare('UPDATE group_states SET revision = revision + 1 WHERE id = ?').run(account.groupId)
      })
    },
    snapshot(groupId) {
      const result = { public: {}, private: {} }
      // Only current household members count. Never expose other households' individual votes.
      const rows = db.prepare(`SELECT r.* FROM recipe_ratings r JOIN group_states g ON g.id = r.group_id
        WHERE EXISTS (SELECT 1 FROM json_each(g.data, '$.people') p WHERE json_extract(p.value, '$.id') = r.person_id)
        AND (r.scope = 'public' OR r.group_id = ?)
        AND (r.scope = 'public' OR EXISTS (SELECT 1 FROM json_each(g.data, '$.recipeEdits') e WHERE e.key = r.recipe_id))`).all(groupId)
      for (const row of rows) {
        const entry = result[row.scope][row.recipe_id] ??= { total: 0, count: 0, household: {} }
        entry.total += row.score
        entry.count++
        if (row.group_id === groupId) entry.household[row.person_id] = row.score
      }
      return result
    },
    prune(groupId) {
      db.prepare(`DELETE FROM recipe_ratings WHERE group_id = ? AND (
        NOT EXISTS (SELECT 1 FROM group_states g, json_each(g.data, '$.people') p
          WHERE g.id = recipe_ratings.group_id AND json_extract(p.value, '$.id') = recipe_ratings.person_id)
        OR (scope = 'private' AND NOT EXISTS (SELECT 1 FROM group_states g, json_each(g.data, '$.recipeEdits') e
          WHERE g.id = recipe_ratings.group_id AND e.key = recipe_ratings.recipe_id)))`).run(groupId)
    },
  }
}
