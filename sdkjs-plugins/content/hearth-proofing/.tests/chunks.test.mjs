// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// scripts/chunks.js: node --test .tests/chunks.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

globalThis.window = {}
new Function(readFileSync(new URL('../scripts/chunks.js', import.meta.url), 'utf8'))()
const C = globalThis.window.HearthProofing.chunks

test('paragraphs are grouped under the limit and findings come back to them', () => {
  const paras = ['Teh first one.', '', 'A second wiht a typo.', 'x'.repeat(30)]
  const ps = C.pieces(paras, 40)
  assert.equal(ps.length, 2)
  assert.equal(ps[0].text, 'Teh first one.\nA second wiht a typo.')
  assert.deepEqual(ps[0].starts, [[0, 0], [2, 15]])
  const at = ps[0].text.indexOf('wiht')
  assert.deepEqual(C.place(ps[0], { offset: at, length: 4 }), { paragraph: 2, offset: 9, text: 'wiht' })
  assert.deepEqual(C.place(ps[0], { offset: 0, length: 3 }), { paragraph: 0, offset: 0, text: 'Teh' })
  assert.deepEqual(ps[1].starts, [[3, 0]])
})

test('a paragraph longer than the limit is cut, and emoji count as JavaScript counts them', () => {
  const ps = C.pieces(['😀 teh'.padEnd(50, '.')], 20)
  assert.equal(ps[0].text.length, 20)
  assert.deepEqual(C.place(ps[0], { offset: 3, length: 3 }).text, 'teh')
})

test('which appearance of a word is flagged, and replacements applied from the end', () => {
  assert.equal(C.occurrence('the cat the hat the', 'the', 8), 1)
  assert.equal(C.occurrence('the cat', 'the', 2), -1)
  assert.equal(C.corrected('Teh cat sat wiht me', [{ offset: 0, length: 3, value: 'The' }, { offset: 12, length: 4, value: 'with' }]), 'The cat sat with me')
})
