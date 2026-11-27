// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The background page of Spelling and grammar: a button in the Review
// tab and a side panel listing what LanguageTool finds. The text goes to
// Hearth's own page (the shared bridge, channel "proofing"), which asks
// Hearth's API, which asks the LanguageTool server Hearth runs itself; the
// editor never talks to LanguageTool and nothing leaves the server.
//
// In a text document the whole document is checked paragraph by
// paragraph (chunks.js groups them into a few requests), and a fix the
// person picks goes in at its own place: the paragraph's matching words
// are selected and replaced, through the editor's own history (tracked
// if the document tracks changes). In a spreadsheet or a presentation the
// selected text is checked, and the fixes chosen replace the selection.
// Only this page reads or changes the document; the panel shows and
// reports clicks.
(function (window) {
	'use strict';

	const BUTTON = 'hearth_proofing';
	const LAZY = ['../hearth-shared/bridge.js', 'scripts/chunks.js'];

	let editor = '';
	let options = {};
	let loaded = null;
	let bridge = null;
	let panel = null;
	let panelReady = false;
	let paragraphs = [];   // the texts checked, as they are now
	let findings = [];     // { id, paragraph, offset, length, text, message, short, kind, replacements }
	let selectionText = ''; // outside text documents: the selection checked
	let fixes = [];        // outside text documents: the fixes chosen
	let checking = null;   // AbortController of the check running

	function say(name, data) { if (panel && panelReady) panel.command(name, data); }

	function load() {
		if (loaded) return loaded;
		loaded = LAZY.reduce(function (before, src) {
			return before.then(function () {
				return new Promise(function (resolve, reject) {
					const s = document.createElement('script');
					s.src = src;
					s.onload = resolve;
					s.onerror = function () { reject(new Error('Could not load ' + src)); };
					document.head.appendChild(s);
				});
			});
		}, Promise.resolve()).then(function () {
			bridge = window.HearthBridge.create('proofing');
			bridge.setOrigin(options.hearthOrigin);
			return window.HearthProofing;
		});
		loaded.catch(function () { loaded = null; });
		return loaded;
	}

	function method(name, args) {
		return new Promise(function (resolve) { window.Asc.plugin.executeMethod(name, args || [], resolve); });
	}

	function inEditor(fn, scope, change) {
		return new Promise(function (resolve) {
			window.Asc.scope = scope || {};
			window.Asc.plugin.callCommand(fn, false, !!change, resolve);
		});
	}

	// Runs in the editor: every paragraph's text, tables' and all.
	function readParagraphs() {
		return Api.GetDocument().GetAllParagraphs().map(function (p) {
			try { return p.GetText({ Numbering: false, Math: false, NewLineSeparator: ' ' }) || ''; } catch (e) { return ''; }
		});
	}

	// Runs in the editor: selects the n-th appearance of the flagged words
	// in their paragraph, for the paste that follows.
	function selectFlagged() {
		const p = Api.GetDocument().GetAllParagraphs()[Asc.scope.paragraph];
		if (!p) return false;
		const found = p.Search(Asc.scope.text, true) || [];
		const r = found[Asc.scope.n];
		if (!r) return false;
		r.Select();
		return true;
	}

	async function openPanel() {
		if (panel) return;
		load().catch(function () {});
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', async function () {
			panelReady = true;
			try {
				await load();
				say('onSetup', { editor: editor });
				const langs = await bridge.ask('languages', {});
				say('onLanguages', langs);
			} catch (e) {
				say('onProblem', e.message);
			}
		});
		panel.attachEvent('onCheck', check);
		panel.attachEvent('onFix', fix);
		panel.attachEvent('onIgnore', function (id) { findings = findings.filter(function (f) { return f.id !== id; }); });
		panel.attachEvent('onApplySelection', applySelection);
		panel.attachEvent('onWindowClose', function () {
			if (checking) checking.abort();
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'Spelling and grammar', isVisual: true, isModal: false,
			buttons: [], type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true,
			EditorsSupport: ['word', 'cell', 'slide'], size: [320, 520],
		});
	}

	// check reads the text and asks for each piece in turn; findings go to
	// the panel as each piece is done, so the first show at once.
	async function check(request) {
		if (checking) checking.abort();
		const control = checking = new AbortController();
		const P = await load();
		findings = [];
		fixes = [];
		let texts;
		if (editor === 'word') {
			texts = paragraphs = await inEditor(readParagraphs);
		} else {
			selectionText = ((await method('GetSelectedText', [{ Numbering: false, Math: false, ParaSeparator: '\n', NewLineSeparator: '\n' }])) || '');
			if (!selectionText.trim()) { say('onProblem', 'Select the text to check.'); say('onChecked', { count: 0 }); return; }
			texts = [selectionText];
		}
		let id = 0;
		try {
			for (const piece of P.chunks.pieces(texts)) {
				const res = await bridge.request('check', { text: piece.text, language: request.language || 'auto' }, { timeoutMs: 45000, signal: control.signal });
				const found = res.findings.map(function (f) {
					const at = P.chunks.place(piece, f);
					return { id: ++id, paragraph: at.paragraph, offset: at.offset, length: f.length, text: at.text, message: f.message, short: f.short || '',
						kind: f.kind, replacements: f.replacements, context: contextOf(texts[at.paragraph], at.offset, f.length) };
				});
				findings = findings.concat(found);
				say('onFindings', { findings: found, language: res.language });
			}
			say('onChecked', { count: findings.length });
		} catch (e) {
			if (!control.signal.aborted) { say('onProblem', e.message); say('onChecked', { count: findings.length }); }
		} finally {
			if (checking === control) checking = null;
		}
	}

	// contextOf is the words around a finding, for the panel.
	function contextOf(text, offset, length) {
		const from = Math.max(0, offset - 40), to = Math.min(text.length, offset + length + 40);
		return { before: (from > 0 ? '…' : '') + text.slice(from, offset), flagged: text.substr(offset, length), after: text.slice(offset + length, to) + (to < text.length ? '…' : '') };
	}

	// fix puts a replacement in for one finding: { id, value }.
	async function fix(order) {
		const f = findings.find(function (x) { return x.id === order.id; });
		if (!f) return;
		const P = window.HearthProofing;
		if (editor !== 'word') {
			fixes.push({ offset: f.offset, length: f.length, value: order.value });
			findings = findings.filter(function (x) { return x.id !== f.id; });
			say('onFixed', { id: f.id, pending: fixes.length });
			return;
		}
		const text = paragraphs[f.paragraph] || '';
		const n = P.chunks.occurrence(text, f.text, f.offset);
		const ok = n >= 0 && await inEditor(selectFlagged, { paragraph: f.paragraph, text: f.text, n: n });
		if (!ok) { say('onProblem', 'That text has changed since the check. Check again.'); return; }
		await method('PasteText', [order.value]);
		// The paragraph as it now reads, and the later findings in it moved.
		const delta = order.value.length - f.length;
		paragraphs[f.paragraph] = text.slice(0, f.offset) + order.value + text.slice(f.offset + f.length);
		findings = findings.filter(function (x) { return x.id !== f.id; });
		findings.forEach(function (x) { if (x.paragraph === f.paragraph && x.offset > f.offset) x.offset += delta; });
		say('onFixed', { id: f.id });
	}

	// applySelection puts the fixes chosen into the selection (spreadsheets
	// and presentations).
	async function applySelection() {
		const P = window.HearthProofing;
		if (!fixes.length) return;
		await method('PasteText', [P.chunks.corrected(selectionText, fixes)]);
		fixes = [];
		say('onApplied');
	}

	window.Asc.plugin.init = function () {
		options = window.Asc.plugin.info.options || {};
		// Hearth turns it off for a link's visitor and when it has no
		// LanguageTool server.
		if (options.off) return;
		editor = window.Asc.plugin.info.editorType;
		const icons = 'resources/icons/%theme-type%(light|dark)/proofing.svg';
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: 'review', text: 'Review', items: [
			{ id: BUTTON, type: 'big-button', text: 'Spelling and grammar', hint: 'Check spelling, grammar and style', icons: icons, lockInViewMode: true, separator: true },
		] }] }]);
	};

	window.Asc.plugin.event_onToolbarMenuClick = function (id) { if (id === BUTTON) openPanel(); };
	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		say('onThemeChanged', theme);
	};
	window.Asc.plugin.button = function () {};
})(window);
