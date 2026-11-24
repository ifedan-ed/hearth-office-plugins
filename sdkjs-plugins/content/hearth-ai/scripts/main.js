// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The background page of Hearth Assistant. It adds the Assistant tab to the
// toolbar, opens the side panel, and carries each request through: read the
// document (context.js), word the request (tasks.js), ask the model through
// the server's proxy (model.js), hand the answer to the panel as it is
// written, and put it into the document when the person says so (apply.js).
//
// The panel (panel.html) is a page of its own that only shows things and
// reports clicks; only this page may read or change the document, and only
// this page holds the editing session's token.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI;
	const TAB = 'hearth_assistant';

	let editor = '';       // 'word', 'cell' or 'slide'
	let panel = null;      // the side panel window, while it is open
	let panelReady = false;
	let wanted = null;     // the task to show once the panel has loaded
	let running = null;    // AbortController of the request in flight

	// say sends a message to the panel.
	function say(name, data) {
		if (panel && panelReady) panel.command(name, data);
	}

	// The tasks as the panel needs them: no functions, only what it shows.
	function taskList() {
		return HearthAI.tasks.forEditor(editor).map(function (t) {
			return { id: t.id, label: t.label, ask: t.ask, required: !!t.required, big: !!t.big, choices: t.choices || [], uses: t.uses, result: t.result };
		});
	}

	function openPanel(taskId) {
		wanted = taskId;
		if (panel) { say('onTask', taskId); return; }
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', function () {
			panelReady = true;
			say('onSetup', { editor: editor, tasks: taskList(), task: wanted, ready: HearthAI.model.ready() });
		});
		panel.attachEvent('onRun', run);
		panel.attachEvent('onStop', stop);
		panel.attachEvent('onUse', use);
		panel.attachEvent('onWindowClose', function () {
			stop();
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'Assistant', isVisual: true, isModal: false,
			buttons: [], type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true,
			EditorsSupport: ['word', 'cell', 'slide'], size: [340, 500],
		});
	}

	function stop() {
		if (running) running.abort();
		running = null;
	}

	// run carries out one request from the panel: { task, instruction }.
	async function run(request) {
		stop();
		const task = HearthAI.tasks.byId(request.task);
		if (!task) return;
		const control = running = new AbortController();
		try {
			const ctx = await HearthAI.context.gather(editor);
			if (task.needs === 'selection' && !ctx.selection) { say('onProblem', 'Select the text first.'); return; }
			const built = task.build(ctx, (request.instruction || '').trim());
			if (built.problem) { say('onProblem', built.problem); return; }
			say('onStarted', { selection: !!ctx.selection });
			const streamed = task.result === 'text';
			const answer = await HearthAI.model.chat({
				system: built.system, user: built.user, signal: control.signal,
				onDelta: streamed ? function (piece) { say('onDelta', piece); } : null,
			});
			if (control.signal.aborted) return;
			if (streamed) { say('onDone', { text: answer.trim() }); return; }
			const slides = HearthAI.tasks.parseSlides(answer);
			if (slides) say('onDone', { slides: slides }); else say('onProblem', 'The answer could not be read as slides. Try again.');
		} catch (error) {
			if (control.signal.aborted) return;
			say('onProblem', String(error.message).indexOf('not-configured') === 0
				? 'The assistant is not set up on this server.'
				: 'The model could not be reached. Try again.');
			console.error('Hearth Assistant:', error);
		} finally {
			if (running === control) running = null;
		}
	}

	// use puts an answer into the document: { how, text | slides, track }.
	async function use(order) {
		const ways = {
			insert: function () { return HearthAI.apply.insert(editor, order.text); },
			replace: function () { return HearthAI.apply.replace(editor, order.text, !!order.track); },
			comment: function () { return HearthAI.apply.comment(order.text); },
			slides: function () { return HearthAI.apply.slides(order.slides); },
		};
		if (!ways[order.how]) return;
		await ways[order.how]();
		say('onUsed', order.how);
	}

	window.Asc.plugin.init = function () {
		editor = window.Asc.plugin.info.editorType;
		HearthAI.model.configure(window.Asc.plugin.info.aiPluginSettings);
		const items = HearthAI.tasks.forEditor(editor).map(function (task, n) {
			return {
				id: 'hearth_ai_' + task.id, type: 'big-button', text: task.label, hint: task.hint,
				icons: 'resources/icons/' + task.id + '.svg',
				lockInViewMode: true, enableToggle: false, separator: task.id === 'ask' && n > 0,
			};
		});
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: TAB, text: 'Assistant', items: items }] }]);
	};

	// The editor names the button that was clicked.
	window.Asc.plugin.event_onToolbarMenuClick = function (id) {
		if (id.indexOf('hearth_ai_') === 0) openPanel(id.slice('hearth_ai_'.length));
	};

	// The editor's colours changed (light, dark, or a theme of the host's):
	// the panel follows.
	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		say('onThemeChanged', theme);
	};

	window.Asc.plugin.button = function () {};
})(window);
