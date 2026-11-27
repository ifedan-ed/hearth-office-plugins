// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The background page of the Thesaurus: a Thesaurus button in the Review
// tab and a Synonyms entry in the right-click menu, both opening the side
// panel on the word at the cursor (or the selected word). Only this page
// reads or changes the document: the panel looks words up and says which
// synonym was picked, and this page puts it in place of the word.
(function (window) {
	'use strict';

	const BUTTON = 'hearth_thesaurus';
	const MENU = 'hearth_thesaurus_menu';

	let editor = '';
	let panel = null;
	let panelReady = false;
	let word = '';          // the word the panel was opened on
	let fromSelection = false;

	function say(name, data) { if (panel && panelReady) panel.command(name, data); }

	function method(name, args) {
		return new Promise(function (resolve) { window.Asc.plugin.executeMethod(name, args || [], resolve); });
	}

	// current is the selected text, or the word at the cursor (text
	// documents can say which word that is; elsewhere a word must be
	// selected).
	async function current() {
		const picked = ((await method('GetSelectedText', [{ Numbering: false, Math: false, ParaSeparator: ' ', NewLineSeparator: ' ' }])) || '').trim();
		if (picked) return { word: picked.split(/\s+/).slice(0, 3).join(' '), selection: true };
		if (editor !== 'word') return { word: '', selection: false };
		return { word: ((await method('GetCurrentWord')) || '').trim(), selection: false };
	}

	async function open() {
		const c = await current();
		word = c.word;
		fromSelection = c.selection;
		if (panel) { say('onWord', word); return; }
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', function () { panelReady = true; say('onWord', word); });
		panel.attachEvent('onPick', pick);
		panel.attachEvent('onWindowClose', function () {
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'Thesaurus', isVisual: true, isModal: false,
			buttons: [], type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true,
			EditorsSupport: ['word', 'cell', 'slide'], size: [300, 480],
		});
	}

	// pick puts the synonym the person chose in place of the word, as one
	// step in the undo history (the person's own choice: no tracking).
	async function pick(synonym) {
		const c = await current();
		if (c.selection) await method('PasteText', [synonym]);
		else if (editor === 'word' && c.word) await method('ReplaceCurrentWord', [synonym]);
		else { say('onProblem', 'Select the word to replace first.'); return; }
		say('onPicked', synonym);
	}

	window.Asc.plugin.init = function () {
		editor = window.Asc.plugin.info.editorType;
		const icons = 'resources/icons/%theme-type%(light|dark)/thesaurus.svg';
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: 'review', text: 'Review', items: [
			{ id: BUTTON, type: 'big-button', text: 'Thesaurus', hint: 'Synonyms for the word at the cursor', icons: icons, lockInViewMode: true, separator: true },
		] }] }]);
	};

	window.Asc.plugin.event_onToolbarMenuClick = function (id) { if (id === BUTTON) open(); };

	// The right-click menu on text offers Synonyms.
	window.Asc.plugin.event_onContextMenuShow = function (options) {
		if (!options || (options.type !== 'Selection' && options.type !== 'Target')) return;
		window.Asc.plugin.executeMethod('AddContextMenuItem', [{ guid: window.Asc.plugin.guid, items: [{ id: MENU, text: 'Synonyms' }] }]);
	};
	window.Asc.plugin.attachContextMenuClickEvent(MENU, open);

	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		say('onThemeChanged', theme);
	};
	window.Asc.plugin.button = function () {};
})(window);
