// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// How a document's paragraphs become checks and how LanguageTool's
// findings come back to their paragraphs. Paragraphs are joined with a
// line break into pieces of at most LIMIT characters (a paragraph longer
// than that is a piece of its own, cut at LIMIT), so a long document is a
// few requests, each quick; each finding's offset in its piece is turned
// back into a paragraph and an offset in it. Offsets count UTF-16 code
// units, as JavaScript and LanguageTool (Java) both do. No editor calls
// here, so the tests run it as it is.
(function (window) {
	'use strict';

	const P = window.HearthProofing = window.HearthProofing || {};
	const LIMIT = 8000;

	// pieces groups paragraph texts: [{ text, starts: [[paragraph, offset in text]] }].
	function pieces(paragraphs, limit) {
		const max = limit || LIMIT;
		const out = [];
		let cur = null;
		paragraphs.forEach(function (raw, i) {
			const text = raw.length > max ? raw.slice(0, max) : raw;
			if (!text.trim()) return;
			if (!cur || cur.text.length + 1 + text.length > max) {
				cur = { text: '', starts: [] };
				out.push(cur);
			} else {
				cur.text += '\n';
			}
			cur.starts.push([i, cur.text.length]);
			cur.text += text;
		});
		return out;
	}

	// place turns a finding in a piece into { paragraph, offset, text }:
	// the paragraph whose text holds it, and the flagged words themselves.
	function place(piece, finding) {
		let at = piece.starts[0];
		for (const s of piece.starts) { if (s[1] <= finding.offset) at = s; else break; }
		return { paragraph: at[0], offset: finding.offset - at[1], text: piece.text.substr(finding.offset, finding.length) };
	}

	// occurrence is which appearance of word, counted from 0, starts at
	// offset in text (the editor's search finds appearances in order).
	function occurrence(text, word, offset) {
		let n = 0, i = text.indexOf(word);
		while (i >= 0 && i < offset) { n++; i = text.indexOf(word, i + 1); }
		return i === offset ? n : -1;
	}

	// corrected applies chosen replacements ({ offset, length, value }) to
	// text, the later ones first so earlier offsets hold.
	function corrected(text, fixes) {
		return fixes.slice().sort(function (a, b) { return b.offset - a.offset; }).reduce(function (t, f) {
			return t.slice(0, f.offset) + f.value + t.slice(f.offset + f.length);
		}, text);
	}

	P.chunks = { pieces: pieces, place: place, occurrence: occurrence, corrected: corrected, LIMIT: LIMIT };
})(window);
