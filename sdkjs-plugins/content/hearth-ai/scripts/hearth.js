// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The AI Tools' one way to a model: Hearth, asked through Hearth's own page
// (the shared bridge, channel "assistant"), which calls Hearth's API with
// the person's session. Hearth picks the model (the one asked for, if
// LiteLLM offers it, else the person's own), adds the LiteLLM key on the
// server and streams the answer back. The browser holds no key and talks to
// no provider; LiteLLM is the only way out of Hearth.
//
//   models()  the chat models LiteLLM offers, the person's own model, and
//             whether the chat (the Copilot) is on
//   task()    one quick action, nothing kept
//   chat()    a question in the chat beside the document (a Copilot chat)
//   decide()  confirm or decline an action the chat proposed
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};
	const bridge = window.HearthBridge.create('assistant');

	// A model may think for a while before its first word; the wait is
	// renewed by every piece that arrives.
	const WAIT = 120000;

	function connect(origin) { bridge.setOrigin(origin); }
	function ready() { return bridge.ready(); }

	function models() { return bridge.request('models', {}, { timeoutMs: 30000 }); }

	// task resolves with { model, firstMs } once the answer is complete;
	// onText gets each piece of its text.
	function task(t, onText) {
		return bridge.request('task', { model: t.model || '', system: t.system, user: t.user }, {
			timeoutMs: WAIT, signal: t.signal,
			onPart: function (e) { if (e && e.type === 'text' && e.text) onText(e.text); },
		});
	}

	// chat resolves with { chat } (the chat's id) when the turn ends;
	// onEvent gets each of the Copilot's events (text, step, source,
	// action, done, error) as it comes.
	function chat(q, onEvent) {
		return bridge.request('chat', { chat: q.chat || 0, text: q.text, model: q.model || '', document: q.document, key: key() }, {
			timeoutMs: WAIT, signal: q.signal, onPart: onEvent,
		});
	}

	function decide(d, onEvent) {
		return bridge.request('decide', { chat: d.chat, action: d.action, yes: !!d.yes }, { timeoutMs: WAIT, signal: d.signal, onPart: onEvent });
	}

	// key makes a resent question safe: Hearth answers one key once.
	function key() {
		const b = new Uint8Array(12);
		window.crypto.getRandomValues(b);
		return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
	}

	HearthAI.hearth = { connect: connect, ready: ready, models: models, task: task, chat: chat, decide: decide };
})(window);
