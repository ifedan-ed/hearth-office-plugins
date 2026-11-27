// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The side panel's behaviour. It keeps no document state: it shows the
// chat or the quick action the background page names, sends questions and
// instructions back, renders answers as they arrive and reports which use
// the person picked. Nothing goes into the document unless one of an
// answer's buttons is pressed.
//
// The model picker lists the chat models LiteLLM offers (from Hearth) and
// starts on the person's own model, or on the one they picked here before
// (remembered in this browser only); never on a model chosen by this page.
(function (window, document) {
	'use strict';

	const markup = window.HearthAI.markup;
	const el = function (id) { return document.getElementById(id); };
	const send = function (name, data) { window.Asc.plugin.sendToPlugin(name, data); };
	const MODEL_KEY = 'hearth-ai-model';

	// What each use is called on its button.
	const USE_LABELS = { insert: 'Insert', replace: 'Replace', comment: 'Add as comment', slides: 'Add slides', copy: 'Copy' };

	let setup = null;    // { editor, tasks, view, ready, origin } from the background page
	let view = 'chat';   // 'chat' or a task's id
	let task = null;     // the task on show
	let answer = '';     // the quick action's text answer so far
	let slides = null;   // its slides answer
	let turn = null;     // the chat turn being written: { el, text, sources, steps }
	let chatBusy = false;
	let modelsIn = false;  // the model list has come
	let goLater = false;   // a quick action asked for before it came

	function problem(text) {
		el('problem').textContent = text || '';
		el('problem').hidden = !text;
	}

	// node makes an element with a class and text (never markup from strings
	// the model wrote: answers go through markup.toHtml, which escapes).
	function node(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function button(label, cls, onClick) {
		const b = node('button', cls || '', label);
		b.type = 'button';
		b.addEventListener('click', onClick);
		return b;
	}

	// --- The model ---------------------------------------------------------

	function remembered() {
		try { return window.localStorage.getItem(MODEL_KEY) || ''; } catch (e) { return ''; }
	}

	function showModels(m) {
		const select = el('model');
		select.innerHTML = '';
		const list = (m && m.models) || [];
		const pick = list.indexOf(remembered()) >= 0 ? remembered() : (list.indexOf(m.model) >= 0 ? m.model : '');
		if (!pick) select.appendChild(new Option('Choose a model', ''));
		list.forEach(function (name) { select.appendChild(new Option(name, name, false, name === pick)); });
		select.value = pick;
		if (m && m.problem) problem(m.problem);
		el('view-chat').hidden = !(m && m.chat);
		modelsIn = true;
		if (!(m && m.chat) && view === 'chat') showTask(setup.tasks[0] && setup.tasks[0].id);
		else if (goLater) { goLater = false; go(); }
	}

	function model() { return el('model').value; }

	// --- Views -------------------------------------------------------------

	function showView(id) {
		if (id === 'chat' && !el('view-chat').hidden) { showChat(); return; }
		showTask(id === 'chat' ? (setup.tasks[0] && setup.tasks[0].id) : id);
	}

	function selectTab(chat) {
		el('view-chat').setAttribute('aria-selected', String(chat));
		el('view-task').setAttribute('aria-selected', String(!chat));
		el('chat').hidden = !chat;
		el('task').hidden = chat;
	}

	function showChat() {
		view = 'chat';
		selectTab(true);
		problem(setup.ready ? '' : 'Open the document from Hearth to use AI Tools.');
		el('question').focus();
	}

	// --- The chat ----------------------------------------------------------

	function chatBusyState(on) {
		chatBusy = on;
		el('send').hidden = on;
		el('chat-stop').hidden = !on;
	}

	function ask() {
		const text = el('question').value.trim();
		if (!text || chatBusy) return;
		if (!model()) { problem('Choose a model first.'); return; }
		problem('');
		el('question').value = '';
		el('thread').appendChild(node('div', 'turn-q', text));
		startTurn();
		chatBusyState(true);
		send('onAsk', { text: text, model: model() });
	}

	// startTurn adds an answer being written to the thread.
	function startTurn() {
		const box = node('div', 'turn-a');
		const steps = node('div', 'steps');
		const body = node('div', 'answer busy');
		box.appendChild(steps);
		box.appendChild(body);
		el('thread').appendChild(box);
		turn = { el: box, body: body, steps: steps, text: '', sources: [], actions: node('div') };
		box.appendChild(turn.actions);
		scrollDown();
	}

	function scrollDown() { el('thread').scrollTop = el('thread').scrollHeight; }

	// link makes a source's address one the person can open: Hearth's own
	// pages by Hearth's origin, outside pages (PubMed, the web) as they are.
	function link(href) {
		if (typeof href !== 'string' || !href) return '';
		if (href.charAt(0) === '/') return setup.origin ? setup.origin + href : '';
		return /^https?:\/\//.test(href) ? href : '';
	}

	// onEvent takes one of the Copilot's events for the turn being written.
	function onEvent(e) {
		if (!turn || !e) return;
		switch (e.type) {
			case 'text':
				turn.text += e.text || '';
				turn.body.innerHTML = markup.toHtml(turn.text);
				break;
			case 'step':
				if (e.step && e.step.label) turn.steps.textContent = e.step.label + (e.step.state === 'running' ? '…' : '');
				break;
			case 'source':
				if (e.source) turn.sources.push(e.source);
				break;
			case 'action':
				if (e.action) showAction(e.action);
				break;
			case 'error':
				turn.body.appendChild(node('p', 'err', e.error || 'The Copilot could not answer.'));
				break;
		}
		scrollDown();
	}

	// showAction shows an action the chat proposed (save papers to
	// References, say), with Confirm and Decline: nothing is done before.
	function showAction(a) {
		const old = turn.actions.querySelector('[data-action="' + a.id + '"]');
		const box = node('div', 'action');
		box.dataset.action = String(a.id);
		box.appendChild(node('b', '', a.summary || a.tool));
		const fields = (a.fields || []).map(function (f) { return f.label + ': ' + f.value; }).join('\n');
		if (fields) box.appendChild(node('div', 'fields', fields));
		if (a.state === 'pending') {
			const row = node('div', 'row');
			row.appendChild(button('Confirm', 'primary', function () { decide(a.id, true); }));
			row.appendChild(button('Decline', '', function () { decide(a.id, false); }));
			box.appendChild(row);
		} else {
			box.appendChild(node('div', 'fields', a.state + (a.result ? ': ' + a.result : '')));
		}
		if (old) old.replaceWith(box); else turn.actions.appendChild(box);
	}

	function decide(id, yes) {
		if (chatBusy) return;
		chatBusyState(true);
		turn.body.classList.add('busy');
		send('onDecide', { action: id, yes: yes });
	}

	// endTurn finishes the answer: its sources, and the buttons that put it
	// into the document.
	function endTurn(info) {
		chatBusyState(false);
		if (!turn) return;
		turn.body.classList.remove('busy');
		turn.steps.textContent = '';
		const cited = {};
		(turn.text.match(/\[(\d{1,3})\]/g) || []).forEach(function (m) { cited[m.slice(1, -1)] = true; });
		const used = turn.sources.filter(function (s) { return cited[String(s.n)]; });
		if (used.length) {
			const list = node('ol', 'sources');
			used.forEach(function (s) {
				const li = node('li');
				li.value = s.n;
				const href = link(s.link);
				const a = node(href ? 'a' : 'span', '', s.title || s.kind);
				if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
				li.appendChild(a);
				if (s.detail) li.appendChild(document.createTextNode(' · ' + s.detail));
				list.appendChild(li);
			});
			turn.el.appendChild(list);
		}
		if (turn.text.trim() && !(info && info.failed)) {
			const text = turn.text.replace(/\s*\[\d{1,3}\]/g, '');
			const row = node('div', 'row');
			row.appendChild(button('Insert', 'primary', function () { send('onUse', { how: 'insert', text: text, track: true }); }));
			if (setup.editor !== 'cell') row.appendChild(button('Replace selection', '', function () { send('onUse', { how: 'replace', text: text, track: true }); }));
			row.appendChild(button('Copy', '', function () { copy(markup.toPlain(text)); }));
			turn.el.appendChild(row);
		}
		scrollDown();
	}

	function newChat() {
		send('onNewChat');
		chatBusyState(false);
		el('thread').innerHTML = '';
		turn = null;
		problem('');
		el('question').focus();
	}

	// --- A quick action ----------------------------------------------------

	function busy(on) {
		el('go').hidden = on;
		el('stop').hidden = !on;
		el('answer').classList.toggle('busy', on);
	}

	function clearAnswer() {
		answer = '';
		slides = null;
		el('answer').hidden = true;
		el('answer').innerHTML = '';
		el('uses').hidden = true;
	}

	// showTask sets the panel up for one task: its name, its ready-made
	// instructions, its instruction box and the uses of its answer.
	function showTask(id) {
		task = setup.tasks.find(function (t) { return t.id === id; }) || setup.tasks[0];
		if (!task) return;
		view = task.id;
		send('onStop');
		busy(false);
		clearAnswer();
		selectTab(false);
		el('view-task').hidden = false;
		el('view-task').textContent = task.label;
		problem(setup.ready ? '' : 'Open the document from Hearth to use AI Tools.');
		el('go').disabled = !setup.ready;
		el('instruction').value = '';
		el('instruction').hidden = !task.ask;
		el('instruction').placeholder = task.ask;
		el('instruction').classList.toggle('big', task.big);

		el('choices').innerHTML = '';
		el('choices').hidden = task.choices.length === 0;
		task.choices.forEach(function (choice) {
			el('choices').appendChild(button(choice, '', function () { el('instruction').value = choice; go(); }));
		});

		// The use buttons are rebuilt per task; the tracking box stays.
		el('uses').querySelectorAll('button').forEach(function (b) { b.remove(); });
		task.uses.forEach(function (how, n) {
			const b = button(USE_LABELS[how], n === 0 ? 'primary' : '', function () { use(how); });
			b.id = 'use-' + how;
			el('uses').insertBefore(b, el('track-row'));
		});
		el('track-row').hidden = !(setup.editor === 'word' && (task.uses.indexOf('replace') >= 0 || task.uses.indexOf('insert') >= 0));
		if (task.ask) el('instruction').focus();
		// A task that needs nothing typed starts at once.
		if (!task.ask && !task.choices.length) go();
	}

	function go() {
		const instruction = el('instruction').value.trim();
		if (task.required && !instruction) { el('instruction').focus(); return; }
		if (!modelsIn) { goLater = true; busy(true); return; }
		if (!model()) { busy(false); problem('Choose a model first.'); return; }
		problem('');
		clearAnswer();
		busy(true);
		send('onRun', { task: task.id, instruction: instruction, model: model() });
	}

	function showSlides(list) {
		el('answer').innerHTML = list.map(function (s) {
			return '<div class="slide"><b>' + markup.escape(s.title) + '</b><ul>' +
				s.bullets.map(function (b) { return '<li>' + markup.escape(b) + '</li>'; }).join('') + '</ul>' +
				(s.notes ? '<div class="notes">' + markup.escape(s.notes) + '</div>' : '') + '</div>';
		}).join('');
	}

	function use(how) {
		if (how === 'copy') {
			const text = slides ? slides.map(function (s) { return s.title + '\n' + s.bullets.map(function (b) { return '- ' + b; }).join('\n'); }).join('\n\n') : markup.toPlain(answer);
			copy(text);
			return;
		}
		send('onUse', { how: how, text: answer, slides: slides, track: el('track').checked });
	}

	// copy puts text on the clipboard. The panel is a frame inside the
	// editor, where the modern clipboard call is not always allowed, so the
	// older selection-based copy is the route that works everywhere.
	function copy(text) {
		const box = document.createElement('textarea');
		box.value = text;
		document.body.appendChild(box);
		box.select();
		document.execCommand('copy');
		box.remove();
	}

	// applyTheme copies the editor theme's named colours into custom
	// properties (panel.css reads them).
	function applyTheme(theme) {
		if (!theme) return;
		Object.keys(theme).forEach(function (name) {
			if (typeof theme[name] === 'string' && /^[a-z0-9-]+$/i.test(name)) document.documentElement.style.setProperty('--' + name, theme[name]);
		});
	}

	window.Asc.plugin.init = function () {
		const on = function (name, fn) { window.Asc.plugin.attachEvent(name, fn); };
		on('onSetup', function (data) { setup = data; showView(data.view); });
		on('onModels', showModels);
		on('onView', function (id) { if (setup) showView(id); });
		on('onStarted', function () { el('answer').hidden = false; });
		on('onDelta', function (piece) {
			answer += piece;
			el('answer').innerHTML = markup.toHtml(answer);
			el('answer').scrollTop = el('answer').scrollHeight;
		});
		on('onDone', function (data) {
			busy(false);
			el('answer').hidden = false;
			if (data.slides) { slides = data.slides; showSlides(slides); } else { answer = data.text; el('answer').innerHTML = markup.toHtml(answer); }
			el('uses').hidden = false;
		});
		on('onEvent', onEvent);
		on('onTurnDone', endTurn);
		on('onProblem', function (text) { busy(false); chatBusyState(false); if (turn) turn.body.classList.remove('busy'); problem(text); });
		on('onUsed', function (how) { if (how === 'slides') clearAnswer(); });
		on('onThemeChanged', applyTheme);
		send('onPanelReady');
	};
	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		applyTheme(theme);
	};

	el('view-chat').addEventListener('click', function () { showView('chat'); });
	el('view-task').addEventListener('click', function () { if (task) showTask(task.id); });
	el('model').addEventListener('change', function () {
		try { window.localStorage.setItem(MODEL_KEY, model()); } catch (e) { /* this browser keeps nothing */ }
		problem('');
	});
	el('send').addEventListener('click', ask);
	el('chat-stop').addEventListener('click', function () { send('onStop'); chatBusyState(false); if (turn) turn.body.classList.remove('busy'); });
	el('new-chat').addEventListener('click', newChat);
	el('go').addEventListener('click', go);
	el('stop').addEventListener('click', function () { send('onStop'); busy(false); });
	// Ctrl+Enter (Cmd+Enter on a Mac) sends an instruction; in the chat
	// Enter sends and Shift+Enter is a new line, as in Hearth's Copilot.
	el('instruction').addEventListener('keydown', function (event) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); go(); }
	});
	el('question').addEventListener('keydown', function (event) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(); }
	});
})(window, document);
