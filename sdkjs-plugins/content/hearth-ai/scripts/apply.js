// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Puts an accepted answer into the document: inserted at the cursor, in
// place of the selection, as a comment on a cell, or as new slides. Called
// only when the person presses the answer's button in the panel: nothing
// a model writes reaches the document before that. In a text document the
// insert and the replacement are recorded as tracked changes by default,
// so the author still accepts or rejects each one in Review, as a
// colleague's edit. Text goes in with the editor's own paste methods, so
// each use is one step in the undo history and co-editors see it arrive
// like any other edit.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	// The name comments are signed with.
	const AUTHOR = 'AI Tools';

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

	// Runs in the editor: builds real paragraphs from the answer's blocks
	// (markup.toBlocks) and puts them in at the cursor as blocks of their
	// own. Built with the document's own styles ("Heading 1", its body font)
	// rather than pasted as HTML, so the text looks like the rest of the
	// document and starts on a new line instead of running on from the
	// paragraph the cursor is in.
	function insertBlocks() {
		const doc = Api.GetDocument();
		// The editor joins the first paragraph given to the text before the
		// cursor (SelectedContent's common insert): when the cursor's
		// paragraph has text, an empty one first keeps the answer on lines
		// of its own.
		const here = doc.GetCurrentParagraph();
		let text = '';
		try { text = here ? (here.GetText() || '') : ''; } catch (e) { text = ''; }
		const made = text.trim() ? [Api.CreateParagraph()] : [];
		let run = '', numbering = null; // the list the last block belonged to
		Asc.scope.blocks.forEach(function (block) {
			const paragraph = Api.CreateParagraph();
			block.spans.forEach(function (span) {
				const text = paragraph.AddText(span.text);
				if (span.bold) text.SetBold(true);
				if (span.italic) text.SetItalic(true);
			});
			if (block.kind === 'heading') {
				const style = doc.GetStyle('Heading ' + block.level);
				if (style) paragraph.SetStyle(style);
			}
			if (block.kind === 'bullet' || block.kind === 'number') {
				// Neighbouring items share a list; a new run of numbered
				// items starts again at 1.
				if (run !== block.kind) numbering = doc.CreateNumbering(block.kind === 'bullet' ? 'bullet' : 'numbered');
				paragraph.SetNumbering(numbering.GetLevel(0));
			}
			run = block.kind;
			made.push(paragraph);
		});
		doc.InsertContent(made);
		return made.length;
	}

	// insert adds the answer at the cursor, after the selection if there is
	// one. In a text document the answer's headings, lists and bold text
	// become real formatting, as a tracked change when track is set;
	// slides and cells take plain text.
	async function insert(editor, markdown, track) {
		if (editor !== 'word') return method('PasteText', [HearthAI.markup.toPlain(markdown)]);
		return tracked(track, async function () {
			await change(cursorToSelectionEnd);
			return change(insertBlocks, { blocks: HearthAI.markup.toBlocks(markdown) });
		});
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

	// tracked runs fn with change tracking on (when track is set), and puts
	// tracking back the way it was afterwards, even if fn fails.
	async function tracked(track, fn) {
		if (!track) return fn();
		const was = await change(trackOn);
		try {
			return await fn();
		} finally {
			await change(trackRestore, { was: was });
		}
	}

	// replace puts the answer in place of the selection. In a text document
	// it can be recorded as a tracked change, so the author sees the old and
	// the new wording side by side and accepts or rejects it as they would a
	// colleague's edit; tracking is put back the way it was afterwards.
	async function replace(editor, text, track) {
		const plain = HearthAI.markup.toPlain(text);
		if (editor !== 'word') return method('PasteText', [plain]);
		return tracked(track, function () { return method('PasteText', [plain]); });
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
		// The two places text goes, by the placeholder types that can stand
		// for them. A layout's content box is "body" in some decks, "object"
		// in others, and most often carries no type at all, which the file
		// format reads as "object" and the editor reports as "unknown".
		const kinds = { title: ['title', 'ctrTitle'], body: ['body', 'object', 'unknown', 'subTitle'] };
		const find = function (owner, kind) {
			const drawings = owner.GetAllDrawings();
			for (let i = 0; i < drawings.length; i++) {
				let type = '';
				try { const placeholder = drawings[i].GetPlaceholder(); type = placeholder ? placeholder.GetType() : ''; } catch (e) { type = ''; }
				if (kinds[kind].indexOf(type) >= 0) return { shape: drawings[i], type: type };
			}
			return null;
		};
		const holder = function (slide, kind) {
			const present = find(slide, kind);
			if (present) return present.shape;
			const model = layout ? find(layout, kind) : null;
			if (!model) return null;
			const shape = Api.CreateShape('rect', model.shape.GetWidth(), model.shape.GetHeight(), Api.CreateNoFill(), Api.CreateStroke(0, Api.CreateNoFill()));
			shape.SetPosition(model.shape.GetPosX(), model.shape.GetPosY());
			shape.SetPlaceholder(Api.CreatePlaceholder(model.type === 'unknown' ? 'object' : model.type));
			slide.AddObject(shape);
			return shape;
		};
		const fill = function (slide, kind, lines) {
			const shape = holder(slide, kind);
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
