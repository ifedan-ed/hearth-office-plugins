// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The plugin's citations against Zotero's own format and Hearth's:
//   node --test .tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register, createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

register('./resolve-js.mjs', import.meta.url)

const F = await import('../src/app/hearth/zotero-format.js')
const { htmlParagraphs } = await import('../src/app/hearth/runs.js')
const { hostMode } = await import('../src/app/hearth/host.js')
const { CSLCitation } = await import('../src/app/csl/citation/citation.js')
const CSL = createRequire(import.meta.url)('../vendor/citeproc/citeproc_commonjs.js')

const here = (p) => new URL('../' + p, import.meta.url)
const text = (p) => readFileSync(here(p), 'utf8')

test('field kinds, new and old', () => {
  assert.equal(F.fieldKind('ZOTERO_ITEM CSL_CITATION {"citationItems":[]}'), 'citation')
  assert.equal(F.fieldKind(' ADDIN ZOTERO_ITEM CSL_CITATION{}'), 'citation')
  assert.equal(F.fieldKind('ZOTERO_CITATION {"citationItems":[]}'), 'citation')
  assert.equal(F.fieldKind('ZOTERO_BIBL CSL_BIBLIOGRAPHY'), 'bibliography')
  assert.equal(F.fieldKind('ZOTERO_BIBLIOGRAPHY'), 'bibliography')
  assert.equal(F.fieldKind('EN.CITE <EndNote>'), '')
})

test('a citation Value as Zotero writes it', () => {
  const c = new CSLCitation('')
  c.fillFromObject({
    id: 'ABCD2345', type: 'article-journal', title: 'GenBank', userID: 1234,
    author: [{ family: 'Benson', given: 'Dennis A.' }], issued: { 'date-parts': [['2013']] },
    uris: ['https://api.zotero.org/users/1234/items/ABCD2345', 'https://www.zotero.org/someone/items/ABCD2345'],
  })
  c.getCitationItems()[0].setLocator('36').setLabel('page')
  c.setNoteIndex(0).setFormattedCitation('<sup>1</sup>').setPlainCitation('1')
  const value = F.citationValue(c.toJSON())
  assert.ok(value.startsWith('ZOTERO_ITEM CSL_CITATION {"citationID":"'))
  const json = JSON.parse(value.slice(value.indexOf('{')))
  assert.match(json.citationID, /^[A-Za-z0-9]{8}$/)
  assert.deepEqual(Object.keys(json), ['citationID', 'properties', 'citationItems', 'schema'])
  assert.deepEqual(json.properties, { formattedCitation: '<sup>1</sup>', plainCitation: '1', noteIndex: 0 })
  assert.equal(json.schema, 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json')
  const item = json.citationItems[0]
  assert.deepEqual(Object.keys(item), ['id', 'uris', 'itemData', 'locator', 'label'])
  assert.deepEqual(item.uris, ['http://zotero.org/users/1234/items/ABCD2345'])
  assert.equal(item.itemData.title, 'GenBank')
  assert.equal(item.locator, '36')
})

test('a Zotero document citation reads and writes back', () => {
  const zotero = '{"citationID":"Ab3dE5fG","properties":{"formattedCitation":"(1)","plainCitation":"(1)","noteIndex":0},"citationItems":[{"id":42,"uris":["http://zotero.org/groups/77/items/WXYZ6789"],"itemData":{"id":42,"type":"book","title":"T"},"prefix":"see ","suppress-author":true}],"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}'
  const c = new CSLCitation('Ab3dE5fG')
  c.fillFromObject(JSON.parse(zotero))
  const back = c.toJSON()
  assert.equal(back.citationID, 'Ab3dE5fG')
  assert.deepEqual(back.citationItems[0].uris, ['http://zotero.org/groups/77/items/WXYZ6789'])
  assert.equal(back.citationItems[0].prefix, 'see ')
  assert.equal(back.citationItems[0]['suppress-author'], true)
})

test('item URIs in Zotero\'s canonical form', () => {
  assert.equal(F.canonicalUri('https://api.zotero.org/users/1234/items/ABCD2345'), 'http://zotero.org/users/1234/items/ABCD2345')
  assert.equal(F.canonicalUri('https://api.zotero.org/groups/77/items/WXYZ6789?format=json'), 'http://zotero.org/groups/77/items/WXYZ6789')
  assert.equal(F.canonicalUri('http://zotero.org/users/1/items/AAAAAAAA'), 'http://zotero.org/users/1/items/AAAAAAAA')
  // Another library's own URI (Hearth's) stays as it is.
  assert.equal(F.canonicalUri('https://hearth.example/references/items/x/ABCD2345'), 'https://hearth.example/references/items/x/ABCD2345')
  assert.deepEqual(F.canonicalUris(['https://api.zotero.org/users/1/items/ABCD2345', 'https://www.zotero.org/name/items/ABCD2345']), ['http://zotero.org/users/1/items/ABCD2345'])
  assert.deepEqual(F.canonicalUris([], { groupID: 77, key: 'WXYZ6789' }), ['http://zotero.org/groups/77/items/WXYZ6789'])
  assert.deepEqual(F.canonicalUris([], { userID: 5, key: 'not-a-key' }), [])
})

test('the bibliography Value keeps Zotero\'s own JSON', () => {
  const empty = 'ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY'
  assert.equal(F.bibliographyValue(''), empty)
  assert.equal(F.bibliographyValue('ZOTERO_BIBL CSL_BIBLIOGRAPHY'), empty) // upstream's new one
  assert.equal(F.bibliographyValue('ZOTERO_BIBL {broken CSL_BIBLIOGRAPHY'), empty)
  assert.equal(F.bibliographyValue('ZOTERO_BIBL{"uncited":[["http://zotero.org/users/1/items/X"]],"omitted":[],"custom":[]}CSL_BIBLIOGRAPHY'),
    'ZOTERO_BIBL {"uncited":[["http://zotero.org/users/1/items/X"]],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY')
})

test('document preferences as Zotero keeps them', () => {
  const xml = F.prefsXML('http://www.zotero.org/styles/nlm-citation-sequence', true, 'sess1234')
  assert.equal(xml, '<data data-version="3" zotero-version="7.0.0"><session id="sess1234"/><style id="http://www.zotero.org/styles/nlm-citation-sequence" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/></prefs></data>')
  assert.deepEqual(F.prefsChunks(xml), [xml]) // 246 characters: one piece
  const long = F.prefsXML('http://www.zotero.org/styles/journal-of-the-american-college-of-cardiology', false, 'sess1234')
  const chunks = F.prefsChunks(long)
  assert.ok(chunks.length === 2 && chunks.every((c) => c.length <= 255))
  assert.equal(chunks.join(''), long)
  assert.match(long, /hasBibliography="0"/)
  assert.deepEqual(F.readPrefs(xml), { styleID: 'http://www.zotero.org/styles/nlm-citation-sequence', session: 'sess1234' })
  const z = '<data data-version="3" zotero-version="7.0.11"><session id="xzY9"/><style id="http://www.zotero.org/styles/vancouver" locale="en-US" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/></prefs></data>'
  assert.deepEqual(F.readPrefs(z), { styleID: 'http://www.zotero.org/styles/vancouver', session: 'xzY9' })
  assert.equal(F.readPrefs(''), null)
})

test('a document\'s style found among the bundled ones, also by an old id', () => {
  const index = JSON.parse(text('resources/csl/styles/index.json'))
  const renamed = JSON.parse(text('resources/csl/styles/renamed.json'))
  const names = index.map((s) => s.file.replace(/\.csl$/, ''))
  assert.equal(F.resolveStyleName('http://www.zotero.org/styles/apa', names, renamed), 'apa')
  assert.equal(F.resolveStyleName('http://www.zotero.org/styles/vancouver', names, renamed), 'nlm-citation-sequence')
  assert.equal(F.resolveStyleName('http://www.zotero.org/styles/no-such-style', names, renamed), null)
  // Every listed style and parent is in the folder.
  for (const s of index) {
    assert.ok(text('resources/csl/styles/' + s.file).includes('<style'), s.file)
    if (s.parent) assert.ok(index.some((p) => p.id === s.parent), s.parent)
  }
})

test('paragraphs from citeproc HTML', () => {
  const cite = htmlParagraphs('<sup>1,2</sup>')
  assert.deepEqual(cite, { plain: '1,2', paragraphs: [{ Runs: [{ Text: '1,2', VertAlign: 'superscript' }] }] })
  const mixed = htmlParagraphs('(<i>Nature</i> &#38; <span style="font-variant:small-caps;">Smith</span>, 2020)')
  assert.deepEqual(mixed.paragraphs[0].Runs, [
    { Text: '(' }, { Text: 'Nature', Italic: true }, { Text: ' & ' }, { Text: 'Smith', SmallCaps: true }, { Text: ', 2020)' },
  ])
  const bib = htmlParagraphs('<div class="csl-bib-body">\n  <div class="csl-entry">\n    <div class="csl-left-margin">1.</div><div class="csl-right-inline">Benson DA. <i>GenBank</i>.</div>\n  </div>\n  <div class="csl-entry">\n    <div class="csl-left-margin">10.</div><div class="csl-right-inline">Other.</div>\n  </div>\n</div>',
    { secondFieldAlign: true, maxOffset: 4 })
  assert.equal(bib.paragraphs.length, 2)
  assert.equal(bib.paragraphs[0].IndLeft, 480)
  assert.equal(bib.paragraphs[0].IndFirstLine, -480)
  assert.equal(bib.plain, '1. Benson DA. GenBank.\n10. Other.')
  const hang = htmlParagraphs('<div class="csl-entry">A. <i>B</i>.</div>', { hanging: true })
  assert.deepEqual(hang.paragraphs, [{ Runs: [{ Text: 'A. ' }, { Text: 'B', Italic: true }, { Text: '.' }], IndLeft: 720, IndFirstLine: -720 }])
})

// citeproc 2.4.63 with the bundled styles, as the plugin formats.
function engine(file) {
  const items = {
    A: { id: 'A', type: 'article-journal', title: 'GenBank', 'container-title': 'Nucleic Acids Research', author: [{ family: 'Benson', given: 'Dennis A.' }], issued: { 'date-parts': [[2013]] }, volume: '41', page: 'D36-42' },
    B: { id: 'B', type: 'book', title: 'Molecular biology of the cell', author: [{ family: 'Alberts', given: 'Bruce' }], publisher: 'Garland', issued: { 'date-parts': [[2002]] } },
  }
  const sys = {
    retrieveLocale: (l) => text('resources/csl/locales/locales-' + (['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES', 'pt-PT'].includes(l) ? l : 'en-US') + '.xml'),
    retrieveItem: (id) => items[id],
  }
  const e = new CSL.Engine(sys, text('resources/csl/styles/' + file), 'en-US', false)
  e.updateItems(['A', 'B'])
  const out = e.rebuildProcessorState([
    { citationID: 'c1', properties: { noteIndex: 0 }, citationItems: [{ id: 'A' }] },
    { citationID: 'c2', properties: { noteIndex: 0 }, citationItems: [{ id: 'B' }, { id: 'A', locator: '36', label: 'page' }] },
  ], 'html')
  const [params, entries] = e.makeBibliography()
  return { out, params, entries }
}

test('citeproc 2.4.63: a numbered style hangs by its widest number', () => {
  assert.equal(CSL.PROCESSOR_VERSION, '1.4.61')
  const { out, params, entries } = engine('nlm-citation-sequence.csl')
  assert.deepEqual(out.map((r) => htmlParagraphs(r[2]).plain), ['(1)', '(1,2)'])
  const bib = htmlParagraphs(entries.join(''), { hanging: !!params.hangingindent, secondFieldAlign: !!params['second-field-align'], maxOffset: params.maxoffset })
  assert.equal(bib.paragraphs.length, 2)
  assert.equal(bib.paragraphs[0].IndLeft, params.maxoffset * 120)
  assert.ok(bib.paragraphs[0].Runs[0].Text.startsWith('1. Benson DA'))
})

test('citeproc 2.4.63: an author-date style hangs by half an inch, titles in italics', () => {
  const { out, params, entries } = engine('apa.csl')
  assert.equal(htmlParagraphs(out[0][2]).plain, '(Benson, 2013)')
  const bib = htmlParagraphs(entries.join(''), { hanging: !!params.hangingindent, secondFieldAlign: !!params['second-field-align'], maxOffset: params.maxoffset })
  assert.equal(bib.paragraphs[0].IndLeft, 720)
  assert.ok(bib.paragraphs[0].Runs.some((r) => r.Italic && /Molecular biology/.test(r.Text)))
})

test('what the host passes', () => {
  assert.deepEqual(hostMode({ hearth: true, apiKey: ' k ' }), { mode: 'hearth-key', apiKey: 'k' })
  assert.deepEqual(hostMode({ hearth: true }), { mode: 'hearth-no-key', apiKey: '' })
  assert.deepEqual(hostMode({ hearth: true, apiKey: '' }), { mode: 'hearth-no-key', apiKey: '' })
  assert.deepEqual(hostMode({ off: true, apiKey: 'k' }), { mode: 'off', apiKey: '' })
  assert.deepEqual(hostMode(undefined), { mode: 'plugin', apiKey: '' })
  assert.deepEqual(hostMode({}), { mode: 'plugin', apiKey: '' })
})
