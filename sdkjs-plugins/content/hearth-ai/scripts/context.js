// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Reads what the model needs to know about the open document: the selection,
// and per editor the outline and the text around the cursor (documents), the
// active cell with the cells its formula uses (spreadsheets), or the slides'
// text (presentations).
//
// The document is read with callCommand: the function given to it runs
// inside the editor, not here. The editor takes it as source text, so each
// such function must stand alone: it can use Api and Asc.scope and nothing
// from this file.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	// How much text is read at most. A model's context is finite and a
	// request should stay quick; a longer document is cut and the request
	// says so (tasks.js).
	const MAX_DOCUMENT_CHARS = 60000;
	const BEFORE_CURSOR_CHARS = 2500;
	const AFTER_CURSOR_CHARS = 800;

	// inEditor runs fn inside the editor with scope as Asc.scope and resolves
	// with what it returns. Nothing is recalculated: these calls only read.
	function inEditor(fn, scope) {
		return new Promise(function (resolve) {
			window.Asc.scope = scope || {};
			window.Asc.plugin.callCommand(fn, false, false, resolve);
		});
	}

	// selection resolves with the selected text ('' when nothing is
	// selected), in any of the three editors.
	function selection() {
		return new Promise(function (resolve) {
			window.Asc.plugin.executeMethod('GetSelectedText', [{
				Numbering: false, Math: false, TableCellSeparator: '\t', TableRowSeparator: '\n',
				ParaSeparator: '\n', NewLineSeparator: '\n', TabSymbol: '\t',
			}], function (text) { resolve((text || '').trim()); });
		});
	}

	// --- Documents ---------------------------------------------------------

	function readDocument() {
		const doc = Api.GetDocument();
		let text = '';
		try { text = doc.GetText({ Numbering: false, Math: false }) || ''; } catch (e) { text = ''; }
		let headings = [];
		try {
			headings = doc.GetAllHeadingParagraphs().slice(0, 80).map(function (p) { return (p.GetText() || '').trim(); });
		} catch (e) { headings = []; }
		let sentence = '';
		try { sentence = doc.GetCurrentSentence() || ''; } catch (e) { sentence = ''; }
		return { text: text.slice(0, Asc.scope.max), length: text.length, headings: headings.filter(Boolean), sentence: sentence };
	}

	// word resolves with the outline, the whole text (cut to the limit) and
	// the text on either side of the cursor. The editor has no call for "the
	// text before the cursor", so the cursor is found by the sentence it is
	// in; when that sentence cannot be found (an empty paragraph, a repeated
	// sentence is found at its first place) the split falls at the start.
	async function word() {
		const read = await inEditor(readDocument, { max: MAX_DOCUMENT_CHARS });
		const at = read.sentence.trim() ? read.text.indexOf(read.sentence.trim()) : -1;
		const cursor = at < 0 ? 0 : at + read.sentence.trim().length;
		return {
			outline: read.headings,
			text: read.text,
			truncated: read.length > read.text.length,
			before: read.text.slice(Math.max(0, cursor - BEFORE_CURSOR_CHARS), cursor),
			after: read.text.slice(cursor, cursor + AFTER_CURSOR_CHARS),
		};
	}

	// --- Spreadsheets ------------------------------------------------------

	// readCell describes the active cell and every cell or range its formula
	// names, each with its column heading and its row label: what a person
	// looks at to understand a formula.
	function readCell() {
		const active = Api.GetActiveSheet();
		const cell = active.GetActiveCell();
		const colNumber = function (letters) {
			let n = 0;
			for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
			return n;
		};
		const textAt = function (sheet, row, col) {
			try { return String(sheet.GetRangeByNumber(row - 1, col - 1).GetText() || ''); } catch (e) { return ''; }
		};
		const isWords = function (t) { return !!t && isNaN(Number(t.replace(/[,%\s]/g, ''))); };
		// The heading row of a sheet: the first row near the top with words
		// in at least two cells. A lone title above the table is passed over,
		// and a column of words (categories) is not taken for its own
		// heading, which "the nearest words above" would do.
		const headingRows = {};
		const headingRow = function (sheet) {
			const key = sheet.GetName();
			if (headingRows[key] !== undefined) return headingRows[key];
			headingRows[key] = 0;
			for (let r = 1; r <= 20 && !headingRows[key]; r++) {
				let found = 0;
				for (let c = 1; c <= 15; c++) if (isWords(textAt(sheet, r, c).trim())) found++;
				if (found >= 2) headingRows[key] = r;
			}
			return headingRows[key];
		};
		const headingOf = function (sheet, row, col) {
			const top = headingRow(sheet);
			return top && row > top ? textAt(sheet, top, col).trim() : '';
		};
		// The row's label: the first words in the row, left of the cell.
		const labelOf = function (sheet, row, col) {
			for (let c = 1; c < col && c <= 15; c++) {
				const t = textAt(sheet, row, c).trim();
				if (isWords(t)) return t;
			}
			return '';
		};
		const row = cell.GetRow(), col = cell.GetCol();
		const formula = String(cell.GetFormula() || '');
		const out = {
			sheet: active.GetName(), address: cell.GetAddress(false, false, 'xlA1', false),
			formula: formula, value: String(cell.GetText() || ''),
			heading: headingOf(active, row, col), label: labelOf(active, row, col), refs: [],
		};
		if (formula.charAt(0) !== '=') return out;

		// References: an optional sheet name, then A1 or A1:B2. Text in
		// quotes is blanked first so words inside strings are not taken for
		// cells, and a name followed by "(" is a function (LOG10), not a cell.
		const pattern = /(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?(?![A-Za-z0-9_(])/g;
		const seen = {};
		let match;
		const source = formula.replace(/"[^"]*"/g, '""');
		while ((match = pattern.exec(source)) && out.refs.length < 12) {
			const before = source.charAt(match.index - 1);
			if (/[A-Za-z0-9_.]/.test(before) || seen[match[0]]) continue;
			seen[match[0]] = true;
			const sheetName = match[1] || match[2] || '';
			let sheet = active;
			if (sheetName) { try { sheet = Api.GetSheet(sheetName) || null; } catch (e) { sheet = null; } }
			if (!sheet) continue;
			const c1 = colNumber(match[3]), r1 = Number(match[4]);
			const c2 = match[5] ? colNumber(match[5]) : c1, r2 = match[6] ? Number(match[6]) : r1;
			const rows = [];
			// A sample is enough to explain a range: its first rows.
			for (let r = r1; r <= r2 && rows.length < 6; r++) {
				const line = [];
				for (let c = c1; c <= c2 && line.length < 6; c++) line.push(textAt(sheet, r, c));
				rows.push(line);
			}
			let own = '';
			if (r1 === r2 && c1 === c2) {
				try { own = String(sheet.GetRangeByNumber(r1 - 1, c1 - 1).GetFormula() || ''); } catch (e) { own = ''; }
			}
			out.refs.push({
				ref: match[0], cells: (r2 - r1 + 1) * (c2 - c1 + 1), rows: rows,
				formula: own.charAt(0) === '=' ? own : '',
				heading: headingOf(sheet, r1, c1), label: r1 === r2 ? labelOf(sheet, r1, c1) : '',
			});
		}
		return out;
	}

	// readSheet returns the top of the used part of the active sheet as rows
	// of text, for a summary of a sheet when nothing is selected.
	function readSheet() {
		const sheet = Api.GetActiveSheet();
		const used = sheet.GetUsedRange();
		const top = used.GetRow(), left = used.GetCol();
		const rowCount = used.GetRowsCount ? used.GetRowsCount() : 0;
		const rows = [];
		for (let r = 0; r < Math.min(rowCount, Asc.scope.rows); r++) {
			const line = [];
			let blanks = 0;
			// Columns are walked until several in a row are empty: the used
			// range's width has no direct call.
			for (let c = 0; c < Asc.scope.cols && blanks < 4; c++) {
				let t = '';
				try { t = String(sheet.GetRangeByNumber(top - 1 + r, left - 1 + c).GetText() || ''); } catch (e) { t = ''; }
				blanks = t ? 0 : blanks + 1;
				line.push(t);
			}
			rows.push(line.join('\t').replace(/\t+$/, ''));
		}
		return { sheet: sheet.GetName(), rows: rows, totalRows: rowCount };
	}

	async function cell() {
		const sheet = await inEditor(readSheet, { rows: 80, cols: 26 });
		return { active: await inEditor(readCell), sheet: sheet };
	}

	// --- Presentations -----------------------------------------------------

	// readSlides returns each slide's title and remaining text, and which
	// slide is open.
	function readSlides() {
		const presentation = Api.GetPresentation();
		const count = presentation.GetSlidesCount();
		const textOf = function (shape) {
			try {
				const content = shape.GetDocContent();
				const parts = [];
				for (let i = 0; i < content.GetElementsCount(); i++) {
					const t = (content.GetElement(i).GetText() || '').trim();
					if (t) parts.push(t);
				}
				return parts.join('\n');
			} catch (e) { return ''; }
		};
		const slides = [];
		for (let i = 0; i < count && i < Asc.scope.max; i++) {
			let title = '';
			const body = [];
			presentation.GetSlideByIndex(i).GetAllShapes().forEach(function (shape) {
				const text = textOf(shape);
				if (!text) return;
				let kind = '';
				try { const holder = shape.GetPlaceholder(); kind = holder ? holder.GetType() : ''; } catch (e) { kind = ''; }
				if (!title && (kind === 'title' || kind === 'ctrTitle')) title = text; else body.push(text);
			});
			slides.push({ title: title, text: body.join('\n') });
		}
		return { current: presentation.GetCurSlideIndex(), count: count, slides: slides };
	}

	function slide() { return inEditor(readSlides, { max: 150 }); }

	// gather resolves with everything known about the document for one
	// request: its name, the selection, and the part for this editor.
	async function gather(editor) {
		const readers = { word: word, cell: cell, slide: slide };
		const picked = await selection();
		return {
			editor: editor,
			title: window.Asc.plugin.info.documentTitle || '',
			selection: picked,
			detail: await readers[editor](),
		};
	}

	HearthAI.context = { gather: gather, inEditor: inEditor };
})(window);
