// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Keeping the document's citations right: every citation and bibliography
// is formatted together, in document order, with the document's style
// (numbers follow the order of first citation; "et al." and "2019a/b"
// depend on the others), then only the fields whose text changed are
// written back, in one update. Formatting is Hearth's (citeproc with the
// CSL styles, asked through bridge.js), so the editor, Notes and Sites
// format alike.
(function (window) {
	'use strict';

	const F = function () { return window.HearthRefs.fields; };
	const doc = function () { return window.HearthRefs.doc; };
	const bridge = function () { return window.HearthRefs.bridge; };

	// The default style for a document that has none yet: Vancouver
	// (NLM, citation-sequence), Daniel's.
	const DEFAULT_STYLE = 'http://www.zotero.org/styles/nlm-citation-sequence';

	// style is the document's style id (from Zotero's preferences) and its
	// session, or the default.
	async function style() {
		const p = F().readPrefs(await doc().readPrefs());
		return p || { styleID: DEFAULT_STYLE, session: '', fresh: true };
	}

	// setStyle stores a style for the document, as Zotero does.
	async function setStyle(styleID, hasBibliography, session) {
		await doc().writePrefs(F().prefsChunks(F().prefsXML(styleID, hasBibliography, session)));
	}

	// refresh formats every citation and bibliography again and writes the
	// ones that changed. It resolves with { changed, count }.
	async function refresh() {
		const st = await style();
		const all = await doc().fields();
		const cites = [];
		const parsed = [];
		for (const f of all) {
			if (f.kind !== 'citation') continue;
			const c = F().parseCitation(f.value);
			if (c) {
				cites.push(f);
				parsed.push(c);
			}
		}
		const bibs = all.filter(function (f) { return f.kind === 'bibliography'; });
		const answer = await bridge().ask('format', {
			style: st.styleID,
			citations: parsed.map(function (c) {
				return {
					citationID: c.citationID,
					citationItems: c.citationItems.map(function (ci) {
						const x = { key: F().itemKey(ci), itemData: ci.itemData };
						['locator', 'label', 'prefix', 'suffix', 'suppress-author', 'author-only'].forEach(function (k) {
							if (ci[k] !== undefined) x[k] = ci[k];
						});
						return x;
					}),
				};
			}),
			bibliography: bibs.length > 0,
		}, 60000);
		if (st.fresh) await setStyle(st.styleID, !!answer.hasBibliography, '');
		const updates = [];
		parsed.forEach(function (c, i) {
			const out = answer.citations[i];
			const f = cites[i];
			if (c.properties && c.properties.plainCitation === out.plain && c.properties.formattedCitation === out.html && f.content === out.plain) return;
			c.properties = Object.assign({}, c.properties, { formattedCitation: out.html, plainCitation: out.plain, noteIndex: 0 });
			delete c.properties.dontUpdate;
			updates.push({ id: f.id, value: F().citationValue(c), paragraphs: out.paragraphs });
		});
		if (answer.bibliography) {
			for (const b of bibs) {
				if (b.content === answer.bibliography.plain) continue;
				updates.push({ id: b.id, value: F().bibliographyValue(b.value), paragraphs: answer.bibliography.paragraphs });
			}
		}
		await doc().update(updates);
		return { changed: updates.length, count: parsed.length };
	}

	// insertCitation puts a new citation at the cursor, then formats the
	// document: the new one gets its number where it stands, and the ones
	// after it are renumbered.
	async function insertCitation(items) {
		const c = F().newCitation(items);
		await doc().insert(F().citationValue(c), [{ Runs: [{ Text: '[…]' }] }]);
		await refresh();
		return c;
	}

	// editCitation replaces a citation's items.
	async function editCitation(fieldID, value, items) {
		const c = F().parseCitation(value);
		if (!c) return;
		F().setItems(c, items);
		await doc().update([{ id: fieldID, value: F().citationValue(c) }]);
		await refresh();
	}

	// insertBibliography adds the bibliography at the cursor (one per
	// document: an existing one is refreshed instead).
	async function insertBibliography() {
		const bibs = (await doc().fields()).filter(function (f) { return f.kind === 'bibliography'; });
		if (bibs.length) {
			await refresh();
			await doc().select(bibs[0].id);
			return false;
		}
		await doc().insert(F().bibliographyValue(''), [{ Runs: [{ Text: ' ' }] }]);
		await refresh();
		return true;
	}

	window.HearthRefs = window.HearthRefs || {};
	window.HearthRefs.citations = { style: style, setStyle: setStyle, refresh: refresh, insertCitation: insertCitation, editCitation: editCitation, insertBibliography: insertBibliography, DEFAULT_STYLE: DEFAULT_STYLE };
})(window);
