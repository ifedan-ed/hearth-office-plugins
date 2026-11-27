// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The Spelling and grammar panel: the language (or detect), Check, and
// each finding with the words around it, its message and LanguageTool's
// replacements. A replacement's button asks the background page to put it
// in; Ignore drops the finding from the list. Built from DOM nodes only:
// no text from a check ever becomes markup.
(function (window, document) {
	'use strict';

	const el = function (id) { return document.getElementById(id); };
	const send = function (name, data) { window.Asc.plugin.sendToPlugin(name, data); };
	const LANG_KEY = 'hearth-proofing-language';
	const KINDS = { misspelling: 'Spelling', grammar: 'Grammar', style: 'Style', typographical: 'Typography', duplication: 'Repetition', whitespace: 'Spacing' };

	let editor = '';
	let total = 0;

	function say(id, text) { el(id).textContent = text || ''; el(id).hidden = !text; }

	function node(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function showFinding(f) {
		const li = node('li', 'finding');
		li.dataset.id = String(f.id);
		li.appendChild(node('div', 'kind ' + (f.kind || ''), KINDS[f.kind] || f.short || 'Check'));
		const ctx = node('div', 'context');
		ctx.appendChild(document.createTextNode(f.context.before));
		ctx.appendChild(node('mark', '', f.context.flagged));
		ctx.appendChild(document.createTextNode(f.context.after));
		li.appendChild(ctx);
		li.appendChild(node('div', '', f.message));
		const row = node('div', 'row');
		f.replacements.forEach(function (r, n) {
			const b = node('button', n === 0 ? 'primary' : '', r === '' ? '(delete)' : r);
			b.type = 'button';
			b.addEventListener('click', function () { send('onFix', { id: f.id, value: r }); });
			row.appendChild(b);
		});
		const ignore = node('button', '', 'Ignore');
		ignore.type = 'button';
		ignore.addEventListener('click', function () { send('onIgnore', f.id); li.remove(); count(-1); });
		row.appendChild(ignore);
		li.appendChild(row);
		el('findings').appendChild(li);
	}

	function count(delta) {
		total += delta;
		say('state', total === 0 ? 'No problems found.' : total === 1 ? '1 to look at' : total + ' to look at');
	}

	function check() {
		el('findings').innerHTML = '';
		el('apply').hidden = true;
		total = 0;
		say('problem', '');
		say('state', 'Checking…');
		el('check').disabled = true;
		send('onCheck', { language: el('language').value });
	}


	window.Asc.plugin.init = function () {
		const on = function (name, fn) { window.Asc.plugin.attachEvent(name, fn); };
		on('onSetup', function (s) { editor = s.editor; });
		on('onLanguages', function (langs) {
			let kept = '';
			try { kept = window.localStorage.getItem(LANG_KEY) || ''; } catch (e) { kept = ''; }
			(langs || []).forEach(function (l) { el('language').appendChild(new Option(l.name, l.code, false, l.code === kept)); });
		});
		on('onFindings', function (d) { d.findings.forEach(showFinding); total += d.findings.length; });
		on('onChecked', function () { el('check').disabled = false; count(0); });
		on('onFixed', function (d) {
			const li = el('findings').querySelector('[data-id="' + d.id + '"]');
			if (li) li.remove();
			count(-1);
			if (editor !== 'word' && d.pending) el('apply').hidden = false;
		});
		on('onApplied', function () { el('apply').hidden = true; });
		on('onProblem', function (t) { el('check').disabled = false; say('problem', t); });
		window.HearthTheme.follow();
		send('onPanelReady');
	};

	el('check').addEventListener('click', check);
	el('apply').addEventListener('click', function () { send('onApplySelection'); });
	el('language').addEventListener('change', function () {
		try { window.localStorage.setItem(LANG_KEY, el('language').value); } catch (e) { /* kept nowhere */ }
	});
})(window, document);
