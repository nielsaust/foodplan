import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from './store.mjs'
import { createAuth } from './auth.mjs'
import { createRecipeImport } from './recipe-import.mjs'
import { importExample, recipeImportInstructions } from '../domain/recipe-import.ts'

function setup(file = ':memory:') {
  const store = openStore(file)
  createAuth(store, async () => {})
  store.createGroup('group-a', 'Groep A')
  store.createGroup('group-b', 'Groep B')
  store.db.prepare('INSERT INTO accounts (id, email, name, password) VALUES (?, ?, ?, ?)').run('member-a', 'test@example.com', 'Test', 'unused')
  store.db.prepare('INSERT INTO group_memberships VALUES (?, ?, ?, ?)').run('member-a', 'group-a', 'member', null)
  const service = createRecipeImport(store)
  const account = { id: 'member-a', groupId: 'group-a' }
  const create = () => {
    const link = service.create(account)
    return { ...link, code: new URL(link.path, 'http://localhost').searchParams.get('code') }
  }
  return { store, service, create }
}

test('import normalizes servings, reuses terms and maps scalable references within the right household', () => {
  const { store, service, create } = setup()
  const link = create()
  assert.ok(Date.parse(link.expiresAt) - Date.now() <= 900000)
  assert.ok(Date.parse(link.expiresAt) - Date.now() > 899000)
  const result = service.receive(link.code, structuredClone(importExample))
  const state = store.read('group-a').state
  const recipe = state.recipeEdits[result.recipe.id]
  assert.equal(recipe.amounts.water, 150)
  const tomato = Object.values(state.customIngredients).find(item => item.name === 'Tomaten')
  assert.equal(recipe.amounts[tomato.id], 300)
  assert.equal(recipe.steps[0], `Snijd {${tomato.id}} in stukken.`)
  assert.equal(Object.keys(state.recipeEdits).length, 1)
  assert.equal(store.read('group-b').state.recipeEdits, undefined)
  assert.throws(() => service.receive(link.code, importExample), { status: 401 })
  store.db.close()
})

test('validation failures roll back all changes and leave the code usable', () => {
  const { store, service, create } = setup()
  const { code } = create()
  const before = store.read('group-a')
  const invalid = [
    { servings: 0 }, { minutes: 0 }, { source: 'javascript:alert(1)' },
    { ingredients: [] }, { steps: ['Gebruik {ontbreekt}.'] },
    { steps: ['Gebruik {tomaat:2}.'] }, { nutrition: { protein: -1 } },
    { groupId: 'group-b' }, { title: '' }, { tags: null },
    { ingredients: [{ key: 'x', name: 'Water', amount: 5, unit: 'g' }] },
  ]
  for (const changes of invalid) {
    assert.throws(() => service.receive(code, { ...structuredClone(importExample), ...changes }))
    assert.deepEqual(store.read('group-a'), before)
    service.requireActive(code)
  }
  service.receive(code, importExample)
  store.db.close()
})

test('compatible units convert to the existing ingredient unit and new tags are private', () => {
  const { store, service, create } = setup()
  const body = structuredClone(importExample)
  body.ingredients[1] = { key: 'water', name: 'Water', amount: 0.3, unit: 'l' }
  body.tags = ['Zelfgemaakt', 'zelfgemaakt']
  const { recipe: { id } } = service.receive(create().code, body)
  const state = store.read('group-a').state
  assert.equal(state.recipeEdits[id].amounts.water, 150)
  assert.equal(state.recipeEdits[id].tagIds.length, 1)
  assert.equal(Object.values(state.customTags)[0].name, 'Zelfgemaakt')
  assert.equal(store.publicTerms().tags.length, 0)
  store.db.close()
})

test('codes require login, are hashed, rotate and expire at the exact deadline', () => {
  const { store, service, create } = setup()
  assert.throws(() => service.create(null), { status: 401 })
  const first = create()
  const second = create()
  assert.throws(() => service.receive(first.code, importExample), { status: 401 })
  const row = store.db.prepare('SELECT * FROM recipe_import_links').get()
  assert.equal(row.hash, createHash('sha256').update(second.code).digest('hex'))
  assert.ok(!JSON.stringify(row).includes(second.code))
  store.db.prepare('UPDATE recipe_import_links SET expires = ?').run(Date.now())
  assert.throws(() => service.receive(second.code, importExample), { status: 401 })
  for (const code of [null, '', 'invalid', 'x'.repeat(43)]) assert.throws(() => service.requireActive(code), { status: 401 })
  store.db.close()
})

test('blocked accounts, groups and removed memberships invalidate grants', () => {
  for (const kind of ['account', 'group', 'membership']) {
    const { store, service, create } = setup()
    const { code } = create()
    if (kind === 'membership') store.db.prepare('DELETE FROM group_memberships').run()
    else store.db.prepare('INSERT INTO administrative_blocks VALUES (?, ?)').run(kind, kind === 'account' ? 'member-a' : 'group-a')
    assert.throws(() => service.receive(code, importExample), { status: 401 })
    assert.equal(store.read('group-a').state.recipeEdits, undefined)
    store.db.close()
  }
})

test('failure to consume a code rolls back the saved recipe', () => {
  const { store, service, create } = setup()
  const { code } = create()
  const before = store.read('group-a')
  store.db.exec("CREATE TRIGGER reject_consume BEFORE DELETE ON recipe_import_links BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
  assert.throws(() => service.receive(code, importExample), /test rollback/)
  assert.deepEqual(store.read('group-a'), before)
  service.requireActive(code)
  store.db.exec('DROP TRIGGER reject_consume')
  service.receive(code, importExample)
  store.db.close()
})

test('agent instruction includes the usable endpoint, deadline, clarification and scaling rules', () => {
  const instruction = recipeImportInstructions('https://example.com/api/recipe-import?code=secret', '2026-11-16T12:15:00.000Z')
  for (const expected of ['?code=secret', '2026-11-16T12:15:00.000Z', 'VRAAG DOOR', 'Content-Type: application/json', 'PER PORTIE', 'HTTP 201', 'HTTP 401']) {
    assert.ok(instruction.includes(expected))
  }
})

test('HTTP endpoints authenticate creation and accept an external agent POST exactly once', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aan-tafel-import-'))
  const file = join(directory, 'test.sqlite')
  const { store } = setup(file)
  const session = 'a'.repeat(43)
  store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(session).digest('hex'), 'member-a', Date.now() + 60000)
  store.db.close()
  const server = spawn(process.execPath, ['--experimental-strip-types', 'server/index.mjs'], {
    env: { ...process.env, DATABASE_PATH: file, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverError = ''
  server.stderr.on('data', chunk => { serverError += chunk })
  try {
    const port = await new Promise((resolve, reject) => {
      let output = ''
      server.stdout.on('data', chunk => {
        output += chunk
        const match = output.match(/luistert op poort (\d+)/)
        if (match) resolve(Number(match[1]))
      })
      server.on('error', reject)
      server.on('exit', code => reject(new Error('Server stopped: ' + code + '\n' + serverError)))
    })
    const base = 'http://127.0.0.1:' + port
    const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' }
    const create = headers => fetch(base + '/api/recipe-import-links', { method: 'POST', headers, body: '{}' })
    assert.equal((await create(jsonHeaders)).status, 401)
    const headers = { ...jsonHeaders, Cookie: 'foodplan_session=' + session }
    assert.equal((await create({ ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 415)
    const response = await create(headers)
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const { path } = await response.json()
    assert.equal((await fetch(base + path)).status, 405)
    const post = (body, headers = jsonHeaders) => fetch(base + path, { method: 'POST', headers, body })
    assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415)
    assert.equal((await post('{')).status, 400)
    assert.equal((await post('x'.repeat(256 * 1024 + 1))).status, 413)
    assert.equal((await post('{}')).status, 400)
    const imported = await post(JSON.stringify(importExample))
    assert.equal(imported.status, 201)
    assert.equal((await imported.json()).recipe.title, importExample.title)
    assert.equal((await post(JSON.stringify(importExample))).status, 401)
    const stateResponse = await fetch(base + '/api/state', { headers: { Cookie: headers.Cookie } })
    const { state } = await stateResponse.json()
    assert.equal(Object.values(state.recipeEdits).length, 1)
    assert.equal(Object.values(state.recipeEdits)[0].amounts.water, 150)
  } finally {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill()
    if (server.exitCode === null) await stopped
    rmSync(directory, { recursive: true, force: true })
  }
})
