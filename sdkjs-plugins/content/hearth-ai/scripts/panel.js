// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The side panel's behaviour. It keeps no document state: it shows the task
// the background page names, sends the instruction back, renders the answer
// as it arrives and reports which use the person picked.
(function (window, document) {
	'use strict';

	const markup = window.HearthAI.markup;
	const el = function (id) { return document.getElementById(id); };
	const send = function (name, data) { window.Asc.plugin.sendToPlugin(name, data); };

	// What each use is called on its button.
	const USE_LABELS = { insert: 'Insert', replace: 'Replace', comment: 'Add as comment', slides: 'Add slides', copy: 'Copy' };

	let setup = null;    // { editor, tasks, ready } from the background page
	let task = null;     // the task on show
	let answer = '';     // the text answer so far
	let slides = null;   // the slides answer

	// busy switches between "can ask" and "an answer is being written".
	function busy(on) {
		el('go').hidden = on;
		el('stop').hidden = !on;
		el('answer').classList.toggle('busy', on);
	}

	function problem(text) {
		el('problem').textContent = text || '';
		el('problem').hidden = !text;
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
		send('onStop');
		busy(false);
		clearAnswer();
		problem(setup.ready ? '' : 'The assistant is not set up on this server.');
		el('go').disabled = !setup.ready;
		el('task-name').textContent = task.label;
		el('instruction').value = '';
		el('instruction').placeholder = task.ask;
		el('instruction').classList.toggle('big', task.big);

		el('choices').innerHTML = '';
		el('choices').hidden = task.choices.length === 0;
		task.choices.forEach(function (choice) {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = choice;
			button.addEventListener('click', function () { el('instruction').value = choice; go(); });
			el('choices').appendChild(button);
		});

		// The use buttons are rebuilt per task; the tracking box stays.
		el('uses').querySelectorAll('button').forEach(function (b) { b.remove(); });
		task.uses.forEach(function (how, n) {
			const button = document.createElement('button');
			button.type = 'button';
			button.id = 'use-' + how;
			button.textContent = USE_LABELS[how];
			if (n === 0) button.className = 'primary';
			button.addEventListener('click', function () { use(how); });
			el('uses').insertBefore(button, el('track-row'));
		});
		el('track-row').hidden = !(setup.editor === 'word' && task.uses.indexOf('replace') >= 0);
		el('instruction').focus();
	}

	function go() {
		const instruction = el('instruction').value.trim();
		if (task.required && !instruction) { el('instruction').focus(); return; }
		problem('');
		clearAnswer();
		busy(true);
		send('onRun', { task: task.id, instruction: instruction });
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
		on('onSetup', function (data) { setup = data; showTask(data.task); });
		on('onTask', function (id) { if (setup) showTask(id); });
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
		on('onProblem', function (text) { busy(false); problem(text); });
		on('onUsed', function (how) { if (how === 'slides') clearAnswer(); });
		on('onThemeChanged', applyTheme);
		send('onPanelReady');
	};
	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		applyTheme(theme);
	};

	el('go').addEventListener('click', go);
	el('stop').addEventListener('click', function () { send('onStop'); busy(false); });
	// Ctrl+Enter (Cmd+Enter on a Mac) sends, as in a chat box; Enter alone
	// stays a new line, because notes and instructions have several.
	el('instruction').addEventListener('keydown', function (event) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); go(); }
	});
})(window, document);
