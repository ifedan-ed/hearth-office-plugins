// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The background page of AI Tools. With the document it only adds the AI
// Tools tab; everything else (LAZY below) loads on the first click, so an
// editor that is opened and never asked costs a few kilobytes.
//
// Then it carries each request through: read the document (context.js),
// word a quick action (tasks.js), ask Hearth (hearth.js, through Hearth's
// own page, with the person's session; Hearth reaches the model through
// LiteLLM), hand the answer to the side panel as it is written, and put it
// into the document only when the person accepts it there (apply.js).
// The chat beside the document is a Copilot chat, carrying the document's
// text with each question.
//
// The panel (panel.html) is a page of its own that only shows things and
// reports clicks; only this page reads or changes the document.
(function (window) {
	'use strict';

	const TAB = 'hearth_ai';

	// The toolbar: one entry per button, in order. A button with `menu`
	// opens a list of tasks (the first is also the button's own click).
	const TOOLBAR = [
		{ id: 'chat', label: 'Chat', hint: 'Chat about this document, with search and References', editors: ['word', 'cell', 'slide'] },
		{ id: 'summarise', label: 'Summarise', hint: 'Summarise the selection, or the whole document', editors: ['word', 'cell', 'slide'], separator: true },
		{ id: 'rewrite', label: 'Rewrite', hint: 'Rewrite the selected text', editors: ['word', 'slide'], menu: ['rewrite', 'simplify', 'expand', 'proofread'] },
		{ id: 'translate', label: 'Translate', hint: 'Translate the selection, or the whole text', editors: ['word', 'slide'] },
		{ id: 'keypoints', label: 'Key points', hint: 'The main points as a list', editors: ['word', 'cell', 'slide'] },
		{ id: 'title', label: 'Suggest title', hint: 'Titles that fit this document', editors: ['word', 'slide'] },
		{ id: 'toc', label: 'Contents', hint: 'A table of contents from the text', editors: ['word'] },
		{ id: 'draft', label: 'Draft', hint: 'Write new text from an instruction', editors: ['word', 'slide'], separator: true },
		{ id: 'explain', label: 'Explain formula', hint: 'Explain the formula in the active cell', editors: ['cell'] },
		{ id: 'slides', label: 'Notes to slides', hint: 'Turn notes into slides', editors: ['slide'] },
	];
	// Words for the tasks in the Rewrite menu.
	const MENU_LABELS = { rewrite: 'Rewrite', simplify: 'Simplify', expand: 'Expand', proofread: 'Proofread' };

	// The scripts loaded on first use, in order.
	const LAZY = ['../hearth-shared/bridge.js', 'scripts/hearth.js', 'scripts/context.js', 'scripts/tasks.js', 'scripts/markup.js', 'scripts/apply.js'];

	let editor = '';       // 'word', 'cell' or 'slide'
	let options = {};      // the host's plugin options
	let loaded = null;     // the promise of the lazy scripts
	let panel = null;      // the side panel window, while it is open
	let panelReady = false;
	let wanted = null;     // the view to show once the panel has loaded
	let running = null;    // AbortController of the request in flight
	let chatId = 0;        // the chat beside this document (0: none yet)

	// load adds the lazy scripts once, one after another.
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
			window.HearthAI.hearth.connect(options.hearthOrigin);
			return window.HearthAI;
		});
		loaded.catch(function () { loaded = null; });
		return loaded;
	}

	// say sends a message to the panel.
	function say(name, data) {
		if (panel && panelReady) panel.command(name, data);
	}

	// The tasks as the panel needs them: no functions, only what it shows.
	function taskList(AI) {
		return AI.tasks.forEditor(editor).map(function (t) {
			return { id: t.id, label: t.label, ask: t.ask, required: !!t.required, big: !!t.big, choices: t.choices || [], uses: t.uses, result: t.result };
		});
	}

	function openPanel(view) {
		wanted = view;
		if (panel) { say('onView', view); return; }
		// The scripts load while the panel's page does.
		load().catch(function () {});
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', async function () {
			panelReady = true;
			try {
				const AI = await load();
				say('onSetup', { editor: editor, tasks: taskList(AI), view: wanted, ready: AI.hearth.ready(), origin: options.hearthOrigin || '' });
				AI.hearth.models().then(function (m) { say('onModels', m); }, function (e) { say('onModels', { models: [], model: '', chat: false, problem: e.message }); });
			} catch (error) {
				problem(error);
			}
		});
		panel.attachEvent('onRun', run);
		panel.attachEvent('onAsk', ask);
		panel.attachEvent('onDecide', decide);
		panel.attachEvent('onNewChat', function () { stop(); chatId = 0; });
		panel.attachEvent('onStop', stop);
		panel.attachEvent('onUse', use);
		panel.attachEvent('onWindowClose', function () {
			stop();
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'AI Tools', isVisual: true, isModal: false,
			buttons: [], type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true,
			EditorsSupport: ['word', 'cell', 'slide'], size: [360, 560],
		});
	}

	function stop() {
		if (running) running.abort();
		running = null;
	}

	// problem tells the panel what went wrong, in words for the person.
	function problem(error) {
		if (error && error.name === 'AbortError') return;
		say('onProblem', String((error && error.message) || error || 'Hearth could not do this.'));
	}

	// run carries out one quick action from the panel: { task, instruction, model }.
	async function run(request) {
		stop();
		const control = running = new AbortController();
		try {
			const AI = await load();
			const task = AI.tasks.byId(request.task);
			if (!task) return;
			const ctx = await AI.context.gather(editor);
			if (task.needs === 'selection' && !ctx.selection) { say('onProblem', 'Select the text first.'); return; }
			const built = task.build(ctx, (request.instruction || '').trim());
			if (built.problem) { say('onProblem', built.problem); return; }
			say('onStarted', { selection: !!ctx.selection });
			let answer = '';
			const streamed = task.result === 'text';
			const done = await AI.hearth.task({ model: request.model, system: built.system, user: built.user, signal: control.signal }, function (piece) {
				answer += piece;
				if (streamed) say('onDelta', piece);
			});
			if (control.signal.aborted) return;
			if (streamed) { say('onDone', { text: answer.trim(), model: done.model, selection: !!ctx.selection }); return; }
			const slides = AI.tasks.parseSlides(answer);
			if (slides) say('onDone', { slides: slides, model: done.model }); else say('onProblem', 'The answer could not be read as slides. Try again.');
		} catch (error) {
			if (!control.signal.aborted) problem(error);
		} finally {
			if (running === control) running = null;
		}
	}

	// ask sends a chat question with the document as it is now:
	// { text, model }. The Copilot's events go to the panel as they come.
	async function ask(question) {
		stop();
		const control = running = new AbortController();
		try {
			const AI = await load();
			const ctx = await AI.context.gather(editor);
			const doc = { name: ctx.title || 'untitled', text: AI.tasks.documentText(ctx) };
			const answer = await AI.hearth.chat({ chat: chatId, text: question.text, model: question.model, document: doc, signal: control.signal }, function (e) {
				if (e.type === 'chat' && e.chat) chatId = e.chat.id;
				say('onEvent', e);
			});
			chatId = answer.chat || chatId;
			say('onTurnDone', { chat: chatId, selection: !!ctx.selection });
		} catch (error) {
			if (!control.signal.aborted) problem(error);
			say('onTurnDone', { chat: chatId, failed: true });
		} finally {
			if (running === control) running = null;
		}
	}

	// decide confirms or declines an action the chat proposed: { action, yes }.
	async function decide(d) {
		stop();
		const control = running = new AbortController();
		try {
			const AI = await load();
			await AI.hearth.decide({ chat: chatId, action: d.action, yes: !!d.yes, signal: control.signal }, function (e) { say('onEvent', e); });
			say('onTurnDone', { chat: chatId });
		} catch (error) {
			if (!control.signal.aborted) problem(error);
			say('onTurnDone', { chat: chatId, failed: true });
		} finally {
			if (running === control) running = null;
		}
	}

	// use puts an accepted answer into the document:
	// { how, text | slides, track }. Nothing reaches the document before
	// this: the panel shows the answer and the person picks.
	async function use(order) {
		try {
			const AI = await load();
			const ways = {
				insert: function () { return AI.apply.insert(editor, order.text, !!order.track); },
				replace: function () { return AI.apply.replace(editor, order.text, !!order.track); },
				comment: function () { return AI.apply.comment(order.text); },
				slides: function () { return AI.apply.slides(order.slides); },
			};
			if (!ways[order.how]) return;
			await ways[order.how]();
			say('onUsed', order.how);
		} catch (error) {
			problem(error);
		}
	}

	// toolbarItems are the AI Tools tab's buttons for this editor.
	function toolbarItems() {
		const icon = function (id) { return 'resources/icons/%theme-type%(light|dark)/' + id + '.svg'; };
		return TOOLBAR.filter(function (b) { return b.editors.indexOf(editor) >= 0; }).map(function (b) {
			const item = {
				id: 'hearth_ai_' + b.id, type: 'big-button', text: b.label, hint: b.hint,
				// One drawing per theme type: dark strokes for light themes
				// and light strokes for dark ones. The editor fills in the
				// bracketed part from the theme in use. The chat also works
				// on a document opened for reading; the rest change it.
				icons: icon(b.id), lockInViewMode: b.id !== 'chat', enableToggle: false, separator: !!b.separator,
			};
			if (b.menu) {
				item.split = true;
				item.items = b.menu.map(function (id) { return { id: 'hearth_ai_' + id, text: MENU_LABELS[id] }; });
			}
			return item;
		});
	}

	window.Asc.plugin.init = function () {
		options = window.Asc.plugin.info.options || {};
		// The host turns the AI Tools off (Hearth: for a link's visitor, or
		// while its admins have the editor's assistant off); the image's
		// add-ins start by themselves, so the add-in shows no tab then.
		if (options.off) return;
		editor = window.Asc.plugin.info.editorType;
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: TAB, text: 'AI Tools', items: toolbarItems() }] }]);
	};

	// The editor names the button or menu entry that was clicked.
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
