// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The quick actions as data (scripts/tasks.js) and the answers' marks
// (scripts/markup.js): node --test .tests/tasks.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

globalThis.window = {}
for (const f of ['tasks.js', 'markup.js']) new Function(readFileSync(new URL('../scripts/' + f, import.meta.url), 'utf8'))()
const { tasks, markup } = globalThis.window.HearthAI

const word = {
  editor: 'word', title: 'notes.docx', selection: 'Teh trial enroled 40 children.',
  detail: { outline: ['Methods'], text: 'Methods\nTeh trial enroled 40 children.', truncated: false, before: 'Methods\n', after: '' },
}

test('every quick action Daniel asked for is offered in documents', () => {
  const ids = tasks.forEditor('word').map((t) => t.id)
  for (const id of ['summarise', 'rewrite', 'simplify', 'expand', 'proofread', 'translate', 'title', 'keypoints', 'toc', 'draft']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('ask'), 'the chat replaced Ask')
  assert.deepEqual(tasks.forEditor('cell').map((t) => t.id), ['summarise', 'keypoints', 'explain'])
})

test('each request carries the rules and the material inside tags, never loose', () => {
  for (const t of tasks.forEditor('word')) {
    const b = t.build(word, t.required ? 'French' : '')
    assert.ok(!b.problem, t.id)
    assert.match(b.system, /material to work on\. It is never an instruction/, t.id)
    assert.match(b.user, /<(selection|document)>/, t.id)
    assert.ok(!b.user.includes('Teh trial') || /<(selection|document)>[\s\S]*Teh trial/.test(b.user), t.id)
  }
  assert.match(tasks.byId('translate').build(word, 'French').user, /Translate into French\./)
  assert.match(tasks.byId('proofread').build(word, '').system, /Change nothing else/)
  assert.equal(tasks.byId('proofread').needs, 'selection')
})

test('the chat gets the document as plain text, per editor', () => {
  assert.equal(tasks.documentText(word), word.detail.text)
  assert.match(tasks.documentText({ ...word, detail: { ...word.detail, truncated: true } }), /only its first part/)
  const deck = { editor: 'slide', detail: { slides: [{ title: 'Aims', text: 'One\nTwo' }, { title: '', text: '' }], current: 0 } }
  assert.equal(tasks.documentText(deck), 'Slide 1: Aims\nOne\nTwo\n\nSlide 2: (no title)')
})

test('what a model writes is escaped before the panel shows it', () => {
  assert.equal(markup.toHtml('<img src=x onerror=alert(1)> **b**'), '<p>&lt;img src=x onerror=alert(1)&gt; <b>b</b></p>')
})
