// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Reading and changing the document's citations through the editor's
// plugin API: the add-in fields (each citation and the bibliography are
// one field each, in Zotero's format: fields.js) and the custom properties
// that hold the document's style. Every change goes through the editor's
// own history, so it can be undone and co-authors see it arrive.
//
// A field's visible result is given as formatted paragraphs (Hearth
// Office's AddinFieldData.Paragraphs: runs with italic, bold, small
// capitals and superscript; a hanging indent per paragraph), written by
// the editor inside the field in one step.
(function (window) {
	'use strict';

	const plugin = function () { return window.Asc.plugin; };

	function method(name, args) {
		return new Promise(function (resolve) { plugin().executeMethod(name, args, resolve); });
	}

	// command runs fn inside the editor (Asc.scope carries data in) and
	// resolves with what it returns.
	function command(fn, scope, recalc) {
		Object.assign(window.Asc.scope, scope || {});
		return new Promise(function (resolve) { plugin().callCommand(fn, false, !!recalc, resolve); });
	}

	// fields lists the document's citations and bibliographies, in the
	// order they stand in the document, each { id, kind, value, content }.
	async function fields() {
		const all = (await method('GetAllAddinFields')) || [];
		const out = [];
		for (const f of all) {
			const k = window.HearthRefs.fields.kind(f.Value);
			if (k) out.push({ id: f.FieldId, kind: k, value: f.Value, content: f.Content || '' });
		}
		return out;
	}

	// current is the citation or bibliography the cursor is in, or null.
	async function current() {
		const f = await method('GetCurrentAddinField');
		if (!f) return null;
		const k = window.HearthRefs.fields.kind(f.Value);
		return k ? { id: f.FieldId, kind: k, value: f.Value, content: f.Content || '' } : null;
	}

	// insert puts a new field at the cursor and moves the cursor past it,
	// so typing goes on after the citation, not inside it.
	async function insert(value, paragraphs) {
		await method('AddAddinField', [{ FieldId: '', Value: value, Content: ' ', Paragraphs: paragraphs }]);
		const f = await method('GetCurrentAddinField');
		await command(function () { Api.GetDocument().MoveCursorRight(1, false); });
		return f ? f.FieldId : '';
	}

	// update changes fields: [{ id, value?, paragraphs? }].
	async function update(list) {
		if (!list.length) return;
		const data = list.map(function (x) {
			const d = { FieldId: x.id };
			if (x.value) d.Value = x.value;
			if (x.paragraphs) d.Paragraphs = x.paragraphs;
			return d;
		});
		await method('UpdateAddinFields', [data]);
	}

	// select selects a field (finding a citation mark in the document).
	function select(id) {
		return method('SelectAddinField', [id]);
	}

	// unlink turns fields into their plain text.
	async function unlink(ids) {
		for (const id of ids) await method('RemoveFieldWrapper', [id]);
	}

	// readPrefs is the joined ZOTERO_PREF_n text ('' when none).
	async function readPrefs() {
		const text = await command(function () {
			const props = Api.GetDocument().GetCustomProperties();
			let out = '';
			for (let n = 1; n < 100; n++) {
				const v = props.Get('ZOTERO_PREF_' + n);
				if (v === undefined || v === null || v === '') break;
				out += v;
			}
			return out;
		});
		return typeof text === 'string' ? text : '';
	}

	// writePrefs stores the preferences, chunk by chunk.
	function writePrefs(chunks) {
		return command(function () {
			const props = Api.GetDocument().GetCustomProperties();
			Asc.scope.chunks.forEach(function (c, n) { props.Add('ZOTERO_PREF_' + (n + 1), c); });
		}, { chunks: chunks });
	}

	window.HearthRefs = window.HearthRefs || {};
	window.HearthRefs.doc = { fields: fields, current: current, insert: insert, update: update, select: select, unlink: unlink, readPrefs: readPrefs, writePrefs: writePrefs };
})(window);
