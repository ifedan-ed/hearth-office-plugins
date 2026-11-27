// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Finding a word in the Thesaurus' data packs (data/<code>/, built from
// the OpenOffice/LibreOffice thesauruses by .dev/build-data.mjs): the
// pack's index names its shards by prefix; a word is looked for in the
// shard of the longest prefix its lower case starts with. Each file is
// fetched once, from the Document Server itself, and kept for the page's
// life. Nothing is sent anywhere else.
//
// A word not found as written is tried in its plain forms (English
// endings: "studies" as "study", "running" as "run"), since the
// thesauruses list words in their dictionary form.
(function (window) {
	'use strict';

	const T = window.HearthThesaurus = window.HearthThesaurus || {};
	const cache = new Map();

	// get fetches one JSON file of the data, once.
	function get(path, fetchFn) {
		if (!cache.has(path)) {
			const p = (fetchFn || window.fetch)(path).then(function (r) {
				if (!r.ok) throw new Error('The thesaurus data is missing (' + r.status + ').');
				return r.json();
			});
			p.catch(function () { cache.delete(path); });
			cache.set(path, p);
		}
		return cache.get(path);
	}

	// prefixOf is the build's own rule: letters stay, anything else is '_'.
	function prefixOf(key, len) {
		const out = Array.from(key).slice(0, len).map(function (c) { return /\p{L}/u.test(c) ? c : '_'; }).join('');
		return out || '_';
	}

	// shardOf is the index of the shard holding key, or -1.
	function shardOf(prefixes, key) {
		for (let len = Array.from(key).length; len >= 1; len--) {
			const i = prefixes.indexOf(prefixOf(key, len));
			if (i >= 0) return i;
		}
		return -1;
	}

	// plainForms are the forms tried after the word itself (English).
	function plainForms(word) {
		const w = word.toLowerCase();
		const out = [];
		const add = function (x) { if (x && x !== w && out.indexOf(x) < 0 && x.length > 1) out.push(x); };
		if (/ies$/.test(w)) add(w.replace(/ies$/, 'y'));
		if (/(ss|sh|ch|x|z)es$/.test(w)) add(w.replace(/es$/, ''));
		if (/s$/.test(w) && !/ss$/.test(w)) add(w.replace(/s$/, ''));
		if (/ied$/.test(w)) add(w.replace(/ied$/, 'y'));
		if (/ed$/.test(w)) { add(w.replace(/d$/, '')); add(w.replace(/ed$/, '')); add(w.replace(/(.)\1ed$/, '$1')); }
		if (/ing$/.test(w)) { add(w.replace(/ing$/, '')); add(w.replace(/ing$/, 'e')); add(w.replace(/(.)\1ing$/, '$1')); }
		if (/ly$/.test(w)) add(w.replace(/ly$/, ''));
		if (/er$/.test(w)) { add(w.replace(/er$/, '')); add(w.replace(/r$/, '')); }
		if (/est$/.test(w)) { add(w.replace(/est$/, '')); add(w.replace(/st$/, '')); }
		return out;
	}

	// distinct keeps each synonym once, in the first meaning that lists it
	// (WordNet's senses of one word repeat many), and drops meanings left
	// empty.
	function distinct(meanings) {
		const seen = new Set();
		return meanings.map(function (m) {
			return [m[0], m[1].filter(function (w) {
				const k = w.toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			})];
		}).filter(function (m) { return m[1].length > 0; });
	}

	// find resolves with { word, meanings: [[partOfSpeech, [synonyms]]] }
	// for word in the pack at base (data/en_US/), or null. base and fetchFn
	// are given by the tests.
	async function find(base, word, fetchFn) {
		const clean = String(word || '').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
		if (!clean) return null;
		const index = await get(base + 'index.json', fetchFn);
		const forms = [clean.toLowerCase()].concat(plainForms(clean));
		for (const key of forms) {
			const n = shardOf(index.prefixes, key);
			if (n < 0) continue;
			const shard = await get(base + n + '.json', fetchFn);
			const entries = shard[key];
			if (entries && entries.length) {
				return { word: entries[0].word, meanings: distinct(entries.reduce(function (all, e) { return all.concat(e.meanings); }, [])) };
			}
		}
		return null;
	}

	T.lookup = { find: find, plainForms: plainForms, prefixOf: prefixOf };
})(window);
