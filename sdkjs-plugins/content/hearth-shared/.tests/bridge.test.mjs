// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// bridge.js against a stand-in for Hearth's page: node --test .tests/bridge.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HEARTH = 'https://hearth.example'

// A page inside a frame: what it posts to the top, and a way to answer.
function page() {
  const listeners = []
  const sent = []
  const w = {
    addEventListener: (_, fn) => listeners.push(fn),
    top: { postMessage: (m, o) => sent.push({ m, o }) },
  }
  globalThis.window = w
  globalThis.DOMException = globalThis.DOMException ?? Error
  new Function(readFileSync(new URL('../bridge.js', import.meta.url), 'utf8'))()
  const answer = (data, origin = HEARTH) => listeners.forEach((fn) => fn({ origin, data }))
  return { w, sent, answer }
}

test('a request goes to Hearth only, its pieces and its end come back', async () => {
  const { w, sent, answer } = page()
  const b = w.HearthBridge.create('assistant')
  await assert.rejects(b.request('models'), /Open the document from Hearth/)
  b.setOrigin(HEARTH)
  const parts = []
  const p = b.request('task', { user: 'u' }, { onPart: (x) => parts.push(x) })
  assert.deepEqual(sent[0], { m: { hearth: 'assistant', id: 1, op: 'task', args: { user: 'u' } }, o: HEARTH })
  answer({ hearth: 'assistant', id: 1, part: 'a' }, 'https://evil.example') // ignored
  answer({ hearth: 'references', id: 1, part: 'b' }) // another channel: ignored
  answer({ hearth: 'assistant', id: 1, part: 'c' })
  answer({ hearth: 'assistant', id: 1, ok: true, result: { model: 'm' } })
  assert.deepEqual(await p, { model: 'm' })
  assert.deepEqual(parts, ['c'])
})

test('a refusal rejects; a stop tells Hearth to cancel', async () => {
  const { w, sent, answer } = page()
  const b = w.HearthBridge.create('proofing')
  b.setOrigin(HEARTH)
  const p = b.ask('check', {})
  answer({ hearth: 'proofing', id: 1, ok: false, error: 'not set up' })
  await assert.rejects(p, /not set up/)
  const ctl = new AbortController()
  const q = b.request('check', {}, { signal: ctl.signal })
  ctl.abort()
  await assert.rejects(q)
  assert.deepEqual(sent.at(-1).m, { hearth: 'proofing', id: 2, op: 'cancel' })
})
