// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Puts an answer to use in the document: inserted at the cursor, in place of
// the selection, as a comment on a cell, or as new slides. Text goes in with
// the editor's own paste methods, so each use is one step in the undo
// history and co-editors see it arrive like any other edit.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	// The name comments are signed with.
	const AUTHOR = 'Hearth Assistant';

	// method calls one of the editor's plugin methods and resolves with its
	// answer.
	function method(name, args) {
		return new Promise(function (resolve) { window.Asc.plugin.executeMethod(name, args, resolve); });
	}

	// change runs fn inside the editor like context.inEditor, but lets the
	// editor recalculate and redraw afterwards, because fn changes things.
	function change(fn, scope) {
		return new Promise(function (resolve) {
			window.Asc.scope = scope || {};
			window.Asc.plugin.callCommand(fn, false, true, resolve);
		});
	}

	// Runs in the editor. A paste replaces the selection; to add text after
	// selected text instead, the cursor is first put at the selection's end.
	function cursorToSelectionEnd() {
		const range = Api.GetDocument().GetRangeBySelect();
		let text = '';
		try { text = range ? range.GetText() : ''; } catch (e) { text = ''; }
		if (!text) return false;
		range.MoveCursorToPos(range.GetEndPos());
		return true;
	}

	// insert adds the answer at the cursor. In a text document the answer's
	// headings, lists and bold text become real formatting; slides and cells
	// take plain text.
	async function insert(editor, markdown) {
		if (editor !== 'word') return method('PasteText', [HearthAI.markup.toPlain(markdown)]);
		await change(cursorToSelectionEnd);
		return method('PasteHtml', [HearthAI.markup.toHtml(markdown)]);
	}

	// Run in the editor: switch change tracking on and report how it was, and
	// put it back.
	function trackOn() {
		const doc = Api.GetDocument();
		const was = doc.IsTrackRevisions();
		doc.SetTrackRevisions(true);
		return was;
	}
	function trackRestore() { Api.GetDocument().SetTrackRevisions(Asc.scope.was); }

	// replace puts the answer in place of the selection. In a text document
	// it can be recorded as a tracked change, so the author sees the old and
	// the new wording side by side and accepts or rejects it as they would a
	// colleague's edit; tracking is put back the way it was afterwards.
	async function replace(editor, text, track) {
		const plain = HearthAI.markup.toPlain(text);
		if (editor !== 'word' || !track) return method('PasteText', [plain]);
		const was = await change(trackOn);
		await method('PasteText', [plain]);
		return change(trackRestore, { was: was });
	}

	// Runs in the editor: the explanation becomes a comment on the cell.
	function commentActiveCell() {
		return !!Api.GetActiveSheet().GetActiveCell().AddComment(Asc.scope.text, Asc.scope.author);
	}

	function comment(text) {
		return change(commentActiveCell, { text: HearthAI.markup.toPlain(text), author: AUTHOR });
	}

	// Runs in the editor: adds the slides after the open one, on the deck's
	// own "title and content" layout so they take the deck's fonts, colours
	// and bullet style. Text goes into the layout's placeholders; where the
	// new slide has none yet, a placeholder shape is made at the place and
	// size the layout gives it.
	function buildSlides() {
		const presentation = Api.GetPresentation();
		const master = presentation.GetMaster(0);
		const layout = master ? (master.GetLayoutByType('obj') || master.GetLayout(0)) : null;
		const holder = function (slide, type) {
			const present = slide.GetDrawingsByPlaceholderType(type);
			if (present && present.length) return present[0];
			const model = layout ? layout.GetDrawingsByPlaceholderType(type)[0] : null;
			if (!model) return null;
			const shape = Api.CreateShape('rect', model.GetWidth(), model.GetHeight(), Api.CreateNoFill(), Api.CreateStroke(0, Api.CreateNoFill()));
			shape.SetPosition(model.GetPosX(), model.GetPosY());
			shape.SetPlaceholder(Api.CreatePlaceholder(type));
			slide.AddObject(shape);
			return shape;
		};
		const fill = function (slide, type, lines) {
			const shape = holder(slide, type);
			if (!shape || !lines.length) return;
			const content = shape.GetDocContent();
			content.RemoveAllElements();
			lines.forEach(function (line) {
				const paragraph = Api.CreateParagraph();
				paragraph.AddText(line);
				content.Push(paragraph);
			});
		};
		const first = presentation.GetCurSlideIndex() + 1;
		Asc.scope.slides.forEach(function (item, n) {
			const slide = Api.CreateSlide();
			if (layout) slide.ApplyLayout(layout);
			presentation.AddSlide(slide, first + n);
			fill(slide, 'title', item.title ? [item.title] : []);
			fill(slide, 'body', item.bullets);
			if (item.notes) slide.AddNotesText(item.notes);
		});
		return Asc.scope.slides.length;
	}

	function slides(list) { return change(buildSlides, { slides: list }); }

	HearthAI.apply = { insert: insert, replace: replace, comment: comment, slides: slides };
})(window);
