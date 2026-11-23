import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'
import { createAuth } from './auth.mjs'
import { recipes } from '../domain/catalog.ts'

test('guests can browse public pages and approved recipes while household data stays protected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aan-tafel-public-'))
  const database = join(directory, 'test.sqlite')
  const store = openStore(database)
  createAuth(store, async () => {})
  store.createGroup('private-group', 'Private household')
  store.write('private-group', { type: 'saveRecipe', recipe: { ...recipes[0], id: 'private-recipe', title: 'Private dinner' } })
  store.db.prepare("UPDATE recipe_publications SET status = 'archived' WHERE id = ?").run(recipes[0].id)
  const expected = store.db.prepare("SELECT id FROM recipe_publications WHERE status = 'approved'").all().map(row => row.id).sort()
  store.db.close()
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.mjs'], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    await rm(directory, { recursive: true, force: true })
  })
  const port = await new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    const timeout = setTimeout(() => reject(new Error('Server did not start: ' + errors)), 10000)
    child.stderr.on('data', data => { errors += data })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited: ' + errors)) })
    child.stdout.on('data', data => {
      output += data
      const match = /luistert op poort (\d+)/.exec(output)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const base = 'http://127.0.0.1:' + port
  const response = await fetch(base + '/api/catalog')
  assert.equal(response.status, 200)
  const catalog = await response.json()
  assert.deepEqual(catalog.recipes.map(recipe => recipe.id).sort(), expected)
  assert.ok(catalog.terms.ingredients)
  assert.ok(!JSON.stringify(catalog).includes('Private dinner'))
  for (const path of ['/', '/planner', '/recipes', '/recipes/' + expected[0], '/shopping', '/household']) {
    const page = await fetch(base + path)
    assert.equal(page.status, 200, path)
    assert.match(page.headers.get('content-type'), /text\/html/, path)
  }
  assert.deepEqual(await (await fetch(base + '/api/auth/session')).json(), { account: null })
  for (const path of ['/api/state', '/api/backup']) {
    assert.equal((await fetch(base + path)).status, 401, path)
    assert.equal((await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, path)
  }
})
