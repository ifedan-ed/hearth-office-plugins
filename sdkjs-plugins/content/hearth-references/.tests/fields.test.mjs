// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// scripts/fields.js against Zotero's own format: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'

globalThis.window = { crypto: webcrypto }
new Function(readFileSync(new URL('../scripts/fields.js', import.meta.url), 'utf8'))()
const F = globalThis.window.HearthRefs.fields

// A citation as Zotero 7's Word plugin writes it (shape from Zotero's
// integration code: citationID, properties, citationItems, schema).
const zotero = 'ZOTERO_ITEM CSL_CITATION {"citationID":"Ab3dE5fG","properties":{"formattedCitation":"<sup>1</sup>","plainCitation":"1","noteIndex":0},"citationItems":[{"id":42,"uris":["http://zotero.org/users/1234/items/ABCD2345"],"itemData":{"id":42,"type":"article-journal","title":"GenBank","container-title":"Nucleic Acids Research","author":[{"family":"Benson","given":"Dennis A."}],"issued":{"date-parts":[["2013"]]}},"locator":"36","label":"page"}],"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}'

test('kinds of fields', () => {
  assert.equal(F.kind(zotero), 'citation')
  assert.equal(F.kind(' ADDIN ' + zotero), 'citation')
  assert.equal(F.kind('ZOTERO_CITATION {"citationItems":[]}'), 'citation')
  assert.equal(F.kind('CSL_CITATION {"citationItems":[]}'), 'citation') // Mendeley's
  assert.equal(F.kind('ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY'), 'bibliography')
  assert.equal(F.kind('Mendeley Bibliography CSL_BIBLIOGRAPHY'), 'bibliography')
  assert.equal(F.kind('EN.CITE <EndNote>'), '')
})

test('a Zotero citation is read and written back unchanged in meaning', () => {
  const c = F.parseCitation(zotero)
  assert.equal(c.citationID, 'Ab3dE5fG')
  assert.equal(c.citationItems[0].locator, '36')
  assert.equal(F.itemKey(c.citationItems[0]), 'http://zotero.org/users/1234/items/ABCD2345')
  const back = F.citationValue(c)
  assert.ok(back.startsWith('ZOTERO_ITEM CSL_CITATION {'))
  assert.deepEqual(F.parseCitation(back), c)
  // The upstream plugin wrote no space before the JSON; still read.
  assert.equal(F.parseCitation('ZOTERO_ITEM CSL_CITATION' + JSON.stringify(c)).citationID, 'Ab3dE5fG')
  assert.equal(F.parseCitation('ZOTERO_ITEM CSL_CITATION {broken'), null)
})

test('a new citation of Hearth records', () => {
  const item = { id: 7, uri: 'https://hearth.example/references/items/abcdefghijkl/ABCD2345', csl: { type: 'book', title: 'T' } }
  const c = F.newCitation([{ item, locator: '12', prefix: 'see ', suppressAuthor: true }])
  assert.match(c.citationID, /^[a-z0-9]{8}$/)
  assert.equal(c.schema, F.SCHEMA)
  assert.deepEqual(c.properties, { formattedCitation: '', plainCitation: '', noteIndex: 0 })
  const ci = c.citationItems[0]
  assert.deepEqual(ci.uris, [item.uri])
  assert.equal(ci.itemData.id, 7)
  assert.equal(ci.label, 'page')
  assert.equal(ci['suppress-author'], true)
  assert.equal(ci.prefix, 'see ')
})

test('the bibliography keeps Zotero\'s own choices', () => {
  assert.equal(F.bibliographyValue(''), 'ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY')
  const kept = F.bibliographyValue('ZOTERO_BIBL {"uncited":[["http://zotero.org/users/1/items/X"]],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY')
  assert.match(kept, /"uncited":\[\["http:\/\/zotero.org\/users\/1\/items\/X"\]\]/)
})

test('document preferences as Zotero keeps them', () => {
  const xml = F.prefsXML('http://www.zotero.org/styles/apa', true, 'sess1234')
  assert.match(xml, /^<data data-version="3" zotero-version="[^"]+"><session id="sess1234"\/><style id="http:\/\/www.zotero.org\/styles\/apa" hasBibliography="1" bibliographyStyleHasBeenSet="1"\/><prefs><pref name="fieldType" value="Field"\/><\/prefs><\/data>$/)
  const chunks = F.prefsChunks(xml + 'x'.repeat(300))
  assert.ok(chunks.every((c) => c.length <= 255))
  assert.equal(chunks.join(''), xml + 'x'.repeat(300))
  // Zotero's own, with escaped characters.
  const z = '<data data-version="3" zotero-version="7.0.11"><session id="xzY9"/><style id="http://www.zotero.org/styles/vancouver" locale="en-US" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/><pref name="automaticJournalAbbreviations" value="true"/></prefs></data>'
  assert.deepEqual(F.readPrefs(z), { styleID: 'http://www.zotero.org/styles/vancouver', session: 'xzY9' })
  assert.equal(F.readPrefs(''), null)
})
