// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The small part of Markdown the assistant asks models to use (headings,
// bullets, numbered items, bold, italics, paragraphs), turned into HTML for
// the panel and for pasting into a text document, or stripped to plain text
// for slides and cells. Everything is escaped first, so nothing a model
// writes can become markup of its own. Loaded by the background page and by
// the panel.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	function escape(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// inline handles **bold** and *italics* inside one already-escaped line.
	function inline(text) {
		return text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
	}

	// toHtml converts line by line. Consecutive list lines share one list;
	// consecutive text lines share one paragraph; a blank line ends either.
	function toHtml(markdown) {
		const out = [];
		let list = '', paragraph = [];
		const closeList = function () { if (list) { out.push('</' + list + '>'); list = ''; } };
		const closeParagraph = function () { if (paragraph.length) { out.push('<p>' + paragraph.join(' ') + '</p>'); paragraph = []; } };
		markdown.replace(/\r/g, '').split('\n').forEach(function (raw) {
			const line = escape(raw.trim());
			const heading = line.match(/^(#{1,4})\s+(.*)$/);
			const bullet = line.match(/^[-*•]\s+(.*)$/);
			const numbered = line.match(/^\d+[.)]\s+(.*)$/);
			if (!line) { closeParagraph(); closeList(); return; }
			if (heading) {
				closeParagraph(); closeList();
				out.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>');
			} else if (bullet || numbered) {
				closeParagraph();
				const kind = bullet ? 'ul' : 'ol';
				if (list !== kind) { closeList(); out.push('<' + kind + '>'); list = kind; }
				out.push('<li>' + inline((bullet || numbered)[1]) + '</li>');
			} else {
				closeList();
				paragraph.push(inline(line));
			}
		});
		closeParagraph(); closeList();
		return out.join('');
	}

	// toPlain drops the marks and keeps the words, one line per item.
	function toPlain(markdown) {
		return markdown.replace(/\r/g, '').split('\n').map(function (raw) {
			return raw.trim().replace(/^#{1,4}\s+/, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
		}).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	HearthAI.markup = { toHtml: toHtml, toPlain: toPlain, escape: escape };
})(window);
