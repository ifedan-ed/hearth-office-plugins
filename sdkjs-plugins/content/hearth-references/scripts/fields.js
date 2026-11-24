// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Zotero's own format for citations in Word documents, read and written
// here and nowhere else (Hearth, docs/decisions.md, "References,
// citations in documents"). Hearth stores its citations exactly as
// Zotero's Word and LibreOffice plugins do, so a paper written in Hearth
// Office stays live for a co-author who uses Zotero, and the reverse:
//
//   a citation   ADDIN ZOTERO_ITEM CSL_CITATION {citation JSON}
//   a bibliography ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY
//   the document's style, in the custom properties ZOTERO_PREF_1, _2, ...
//     (one XML text cut into pieces of 255 characters)
//
// The citation JSON is Zotero's: citationID, properties (formattedCitation,
// plainCitation, noteIndex), citationItems (id, uris, itemData as CSL-JSON,
// locator, label, prefix, suffix, suppress-author) and the schema address.
// Each item carries its whole CSL record (itemData), which is why any
// citation renders and restyles even where its library is not at hand.
//
// The field's Value as the editor's plugin API sees it has no "ADDIN "
// (the editor adds it). Older Zotero documents say ZOTERO_CITATION and
// ZOTERO_BIBLIOGRAPHY; both are read.
(function (window) {
	'use strict';

	const SCHEMA = 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json';
	const CITATION = 'ZOTERO_ITEM CSL_CITATION ';
	const BIBLIOGRAPHY = 'ZOTERO_BIBL ';
	const BIBLIOGRAPHY_END = ' CSL_BIBLIOGRAPHY';
	// Zotero's preference chunks are at most 255 characters each.
	const PREF_CHUNK = 255;

	// kind tells what an add-in field is: 'citation', 'bibliography' or ''
	// (another plugin's field, left alone).
	function kind(value) {
		const v = String(value || '').replace(/^\s*ADDIN\s+/, '');
		if (/^ZOTERO_(ITEM|CITATION)\b/.test(v) || /^CSL_CITATION\b/.test(v)) return 'citation';
		if (/^ZOTERO_(BIBL|BIBLIOGRAPHY)\b/.test(v) || /^Mendeley Bibliography CSL_BIBLIOGRAPHY/.test(v)) return 'bibliography';
		return '';
	}

	// parseCitation reads a citation field's Value: Zotero's JSON from the
	// first "{" to the end (Zotero itself reads it the same way, and
	// tolerates a missing space before it). null when it does not parse.
	function parseCitation(value) {
		const v = String(value || '');
		const at = v.indexOf('{');
		if (at < 0) return null;
		try {
			const c = JSON.parse(v.slice(at));
			if (!c || !Array.isArray(c.citationItems)) return null;
			return c;
		} catch (e) {
			return null;
		}
	}

	// citationValue writes a citation's Value as Zotero does.
	function citationValue(citation) {
		return CITATION + JSON.stringify(citation);
	}

	// newCitation makes a citation of items: [{item: {id, uri, csl},
	// locator, label, prefix, suffix, suppressAuthor}]. Its id is random, as
	// Zotero's (eight characters).
	function newCitation(items) {
		return {
			citationID: randomID(),
			properties: { formattedCitation: '', plainCitation: '', noteIndex: 0 },
			citationItems: items.map(citationItem),
			schema: SCHEMA,
		};
	}

	function citationItem(x) {
		const data = Object.assign({}, x.item.csl, { id: x.item.id });
		const out = { id: x.item.id, uris: [x.item.uri], itemData: data };
		if (x.locator) {
			out.locator = String(x.locator);
			out.label = x.label || 'page';
		}
		if (x.prefix) out.prefix = String(x.prefix);
		if (x.suffix) out.suffix = String(x.suffix);
		if (x.suppressAuthor) out['suppress-author'] = true;
		return out;
	}

	// setItems replaces a citation's items, keeping its id.
	function setItems(citation, items) {
		citation.citationItems = items.map(citationItem);
		return citation;
	}

	// itemKey is what makes two cited items the same paper across citations
	// (and across documents made elsewhere): the first URI, else the id.
	function itemKey(ci) {
		return (ci.uris && ci.uris[0]) || (ci.uri && ci.uri) || String(ci.id);
	}

	// bibliographyValue is a bibliography field's Value. The JSON part is
	// Zotero's (items added or left out by hand); Hearth keeps whatever is
	// there and writes Zotero's empty one for a new bibliography.
	function bibliographyValue(old) {
		let json = '{"uncited":[],"omitted":[],"custom":[]}';
		const v = String(old || '');
		const a = v.indexOf('{');
		const b = v.lastIndexOf('}');
		if (a >= 0 && b > a) {
			try {
				json = JSON.stringify(JSON.parse(v.slice(a, b + 1)));
			} catch (e) { /* a broken one is replaced */ }
		}
		return BIBLIOGRAPHY + json + BIBLIOGRAPHY_END;
	}

	// prefsXML is the document preferences Zotero keeps: the style's id,
	// that the style has a bibliography, and that citations are fields.
	function prefsXML(styleID, hasBibliography, session) {
		const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
		return '<data data-version="3" zotero-version="7.0.0">' +
			'<session id="' + esc(session || randomID()) + '"/>' +
			'<style id="' + esc(styleID) + '" hasBibliography="' + (hasBibliography ? '1' : '0') + '" bibliographyStyleHasBeenSet="1"/>' +
			'<prefs><pref name="fieldType" value="Field"/></prefs></data>';
	}

	// prefsChunks cuts the preferences into the properties' values.
	function prefsChunks(xml) {
		const out = [];
		for (let i = 0; i < xml.length; i += PREF_CHUNK) out.push(xml.slice(i, i + PREF_CHUNK));
		return out;
	}

	// readPrefs reads the joined ZOTERO_PREF text: the style id and the
	// session, or null.
	function readPrefs(xml) {
		if (!xml) return null;
		const style = /<style\b[^>]*\bid="([^"]+)"/.exec(xml);
		const session = /<session\b[^>]*\bid="([^"]+)"/.exec(xml);
		if (!style) return null;
		const un = function (s) { return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); };
		return { styleID: un(style[1]), session: session ? un(session[1]) : '' };
	}

	function randomID() {
		const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
		const bytes = new Uint8Array(8);
		window.crypto.getRandomValues(bytes);
		let s = '';
		for (let i = 0; i < bytes.length; i++) s += a[bytes[i] % a.length];
		return s;
	}

	window.HearthRefs = window.HearthRefs || {};
	window.HearthRefs.fields = {
		kind: kind, parseCitation: parseCitation, citationValue: citationValue, newCitation: newCitation, setItems: setItems,
		itemKey: itemKey, bibliographyValue: bibliographyValue, prefsXML: prefsXML, prefsChunks: prefsChunks, readPrefs: readPrefs,
		SCHEMA: SCHEMA,
	};
})(typeof window !== 'undefined' ? window : globalThis);
