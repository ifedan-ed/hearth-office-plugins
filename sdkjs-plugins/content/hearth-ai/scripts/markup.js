// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The small part of Markdown the assistant asks models to use (headings,
// bullets, numbered items, bold, italics, paragraphs), read into blocks for
// a text document, turned into HTML for the panel, or stripped to plain text
// for slides and cells. Everything is escaped first, so nothing a model
// writes can become markup of its own. Loaded by the background page and by
// the panel.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	function escape(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// spans splits one line into runs of plain, bold (**x**) and italic (*x*)
	// text: [{ text, bold, italic }].
	function spans(line) {
		const out = [];
		const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
		let last = 0, match;
		while ((match = pattern.exec(line))) {
			if (match.index > last) out.push({ text: line.slice(last, match.index), bold: false, italic: false });
			out.push({ text: match[1] || match[2], bold: !!match[1], italic: !!match[2] });
			last = pattern.lastIndex;
		}
		if (last < line.length) out.push({ text: line.slice(last), bold: false, italic: false });
		return out;
	}

	// toBlocks reads the text line by line into the blocks a document is made
	// of: { kind: 'heading' | 'bullet' | 'number' | 'text', level, spans }.
	// Consecutive text lines are one paragraph; a blank line ends it. Both
	// the HTML for the panel and the paragraphs put into a document are made
	// from this one reading.
	function toBlocks(markdown) {
		const blocks = [];
		let open = null; // the text paragraph still taking lines
		markdown.replace(/\r/g, '').split('\n').forEach(function (raw) {
			const line = raw.trim();
			const heading = line.match(/^(#{1,4})\s+(.*)$/);
			const bullet = line.match(/^[-*•]\s+(.*)$/);
			const numbered = line.match(/^\d+[.)]\s+(.*)$/);
			if (!line) { open = null; return; }
			if (heading) { open = null; blocks.push({ kind: 'heading', level: heading[1].length, spans: spans(heading[2]) }); return; }
			if (bullet || numbered) { open = null; blocks.push({ kind: bullet ? 'bullet' : 'number', level: 0, spans: spans((bullet || numbered)[1]) }); return; }
			if (open) { open.spans = open.spans.concat(spans(' ' + line)); return; }
			open = { kind: 'text', level: 0, spans: spans(line) };
			blocks.push(open);
		});
		return blocks;
	}

	// toHtml renders the blocks; neighbouring list items share one list.
	function toHtml(markdown) {
		const html = function (block) {
			return block.spans.map(function (s) {
				const text = escape(s.text);
				return s.bold ? '<b>' + text + '</b>' : s.italic ? '<i>' + text + '</i>' : text;
			}).join('');
		};
		const lists = { bullet: 'ul', number: 'ol' };
		let out = '', list = '';
		toBlocks(markdown).forEach(function (block) {
			const wanted = lists[block.kind] || '';
			if (list !== wanted) { out += (list ? '</' + list + '>' : '') + (wanted ? '<' + wanted + '>' : ''); list = wanted; }
			if (wanted) out += '<li>' + html(block) + '</li>';
			else if (block.kind === 'heading') out += '<h' + block.level + '>' + html(block) + '</h' + block.level + '>';
			else out += '<p>' + html(block) + '</p>';
		});
		return out + (list ? '</' + list + '>' : '');
	}

	// toPlain drops the marks and keeps the words, one line per item.
	function toPlain(markdown) {
		return markdown.replace(/\r/g, '').split('\n').map(function (raw) {
			return raw.trim().replace(/^#{1,4}\s+/, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
		}).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	HearthAI.markup = { toBlocks: toBlocks, toHtml: toHtml, toPlain: toPlain, escape: escape };
})(window);
