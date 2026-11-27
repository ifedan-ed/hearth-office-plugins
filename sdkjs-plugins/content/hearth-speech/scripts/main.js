// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Speech input: a button on the Home tab that starts and stops Hearth's
// Dictate. The microphone is recorded and the speech recognised on
// Hearth's own page (asked through the shared bridge, channel "speech"),
// with the person's Dictate settings, through LiteLLM on the server, as
// every other microphone in Hearth; this add-in only types the words at
// the cursor, each piece as it is final, joined to the text before it as
// Dictate joins everywhere (a space, a capital at a sentence's start).
// A small panel shows the words still being heard and Stop.
(function (window) {
	'use strict';

	const BUTTON = 'hearth_speech';
	const bridge = window.HearthBridge.create('speech');

	let editor = '';
	let panel = null;
	let panelReady = false;
	let listening = null;  // the listen request's promise, while on
	let typing = Promise.resolve();

	function say(name, data) { if (panel && panelReady) panel.command(name, data); }

	function method(name, args) {
		return new Promise(function (resolve) { window.Asc.plugin.executeMethod(name, args || [], resolve); });
	}

	// type puts one piece's words in at the cursor, after the words before.
	function type(text) {
		typing = typing.then(async function () {
			const before = editor === 'word' ? ((await method('GetCurrentSentence', ['before'])) || '') : '';
			const joined = await bridge.ask('join', { before: before, text: text });
			if (joined) await method('PasteText', [joined]);
		}).catch(function (e) { say('onProblem', e.message); });
	}

	function setButton(on) {
		window.Asc.plugin.executeMethod('UpdateToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: 'home', items: [
			{ id: BUTTON, type: 'big-button', text: on ? 'Stop speech' : 'Speech input', hint: on ? 'Stop typing by speech' : 'Type by speaking', icons: 'resources/icons/%theme-type%(light|dark)/speech.svg', lockInViewMode: true, separator: true },
		] }] }]);
	}

	function openPanel() {
		if (panel) return;
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', function () { panelReady = true; say('onState', listening ? 'listening' : 'idle'); });
		panel.attachEvent('onStop', stop);
		panel.attachEvent('onWindowClose', function () {
			stop();
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'Speech input', isVisual: true, isModal: false,
			buttons: [], type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true,
			EditorsSupport: ['word', 'cell', 'slide'], size: [280, 220],
		});
	}

	// start asks Hearth's page to listen (this click lets it use the
	// microphone) and types each final piece as it comes.
	function start() {
		openPanel();
		setButton(true);
		say('onState', 'starting');
		listening = bridge.request('listen', {}, {
			// Quiet is allowed: the wait is renewed by every piece.
			timeoutMs: 30 * 60 * 1000,
			onPart: function (p) {
				if (p.listening) say('onState', 'listening');
				if (typeof p.interim === 'string') say('onInterim', p.interim);
				if (p.final) type(p.final);
			},
		});
		listening.then(function () { say('onState', 'idle'); }, function (e) { say('onProblem', e.message); }).finally(function () {
			listening = null;
			setButton(false);
			say('onInterim', '');
		});
	}

	// stop ends listening; the words being spoken still come in.
	function stop() {
		if (!listening) return;
		say('onState', 'stopping');
		bridge.ask('stop', {}).catch(function () {});
	}

	window.Asc.plugin.init = function () {
		const options = window.Asc.plugin.info.options || {};
		if (options.off) return;
		editor = window.Asc.plugin.info.editorType;
		bridge.setOrigin(options.hearthOrigin);
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: 'home', text: 'Home', items: [
			{ id: BUTTON, type: 'big-button', text: 'Speech input', hint: 'Type by speaking', icons: 'resources/icons/%theme-type%(light|dark)/speech.svg', lockInViewMode: true, separator: true },
		] }] }]);
	};

	window.Asc.plugin.event_onToolbarMenuClick = function (id) {
		if (id !== BUTTON) return;
		if (listening) stop(); else start();
	};
	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		say('onThemeChanged', theme);
	};
	window.Asc.plugin.button = function () {};
})(window);
