// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The data build and the lookup together, on a small made-up thesaurus in
// the MyThes format: node --test .tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { read, shard, prefixOf } from '../.dev/build-data.mjs'

globalThis.window = {}
new Function(readFileSync(new URL('../scripts/lookup.js', import.meta.url), 'utf8'))()
const L = globalThis.window.HearthThesaurus.lookup

const DAT = Buffer.from([
  'ISO8859-1',
  'run|2', '(verb)|race|sprint|run', '(noun)|dash|sprint',
  'study|1', '(verb)|learn|read up',
  'café|1', '(noun)|coffee shop|coffeehouse',
  "'hood|1", '(noun)|neighbourhood',
  'empty|0',
].join('\n') + '\n', 'latin1')

test('the .dat format is read, the word itself left out of its synonyms', () => {
  const m = read(DAT)
  assert.deepEqual(m.get('run')[0].meanings, [['verb', ['race', 'sprint']], ['noun', ['dash', 'sprint']]])
  assert.equal(m.get('café')[0].word, 'café') // ISO8859-1 decoded
  assert.equal(m.has('empty'), false)
  assert.equal(prefixOf("'hood", 2), '_h')
})

test('a word is found through its shard, in its plain form too', async () => {
  const shards = shard(read(DAT))
  const prefixes = [...shards.keys()].sort()
  const files = { 'p/index.json': { prefixes } }
  prefixes.forEach((p, n) => { files['p/' + n + '.json'] = shards.get(p) })
  const fetched = []
  const fake = async (path) => { fetched.push(path); return { ok: path in files, status: 404, json: async () => files[path] } }
  const run = await L.find('p/', 'Running', fake)
  assert.equal(run.word, 'run')
  assert.equal(run.meanings[0][1][0], 'race')
  assert.equal((await L.find('p/', 'studies', fake)).meanings[0][1][0], 'learn')
  assert.equal((await L.find('p/', '“café”', fake)).word, 'café')
  assert.equal(await L.find('p/', 'xylophone', fake), null)
  // Every file is fetched once.
  assert.equal(new Set(fetched).size, fetched.length)
})

test('English plain forms', () => {
  assert.ok(L.plainForms('studies').includes('study'))
  assert.ok(L.plainForms('running').includes('run'))
  assert.ok(L.plainForms('making').includes('make'))
  assert.ok(L.plainForms('boxes').includes('box'))
})
