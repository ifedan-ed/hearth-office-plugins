// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The way from Hearth's add-ins to Hearth, shared by all of them (AI
// Tools, Citations, Spelling and grammar, Speech input). The editor runs
// inside a frame of Hearth's own page (Hearth Office is opened only from
// there), and that page is the window at the top. An add-in asks it by
// message; Hearth does the work with the person's own session through its
// ordinary API (web/src/screens/office/bridge.ts in Hearth), so no add-in
// holds a token and Hearth needs no rule of its own for the editor.
//
// Hearth's address comes with the editor's settings (the plugin options,
// "hearthOrigin"); requests go only there and answers are taken only from
// there. Hearth checks in turn that a request comes from the editor's
// origin and from inside the editor's own frame.
//
// Messages, each tagged with the add-in's channel:
//   to Hearth     { hearth, id, op, args }          a request
//                 { hearth, id, op: 'cancel' }      stop request id
//   from Hearth   { hearth, id, part }              a piece of a streamed answer
//                 { hearth, id, ok, result, error } the end of request id
(function (window) {
	'use strict';

	// create is one add-in's line to Hearth on its channel.
	function create(channel) {
		const pending = new Map();
		let next = 1;
		let origin = '';

		window.addEventListener('message', function (e) {
			const m = e.data;
			if (!origin || e.origin !== origin || !m || m.hearth !== channel || !pending.has(m.id)) return;
			const p = pending.get(m.id);
			if ('part' in m) { if (p.onPart) p.onPart(m.part); return; }
			pending.delete(m.id);
			clearTimeout(p.timer);
			if (m.ok) p.resolve(m.result);
			else p.reject(new Error(m.error || 'Hearth could not do this.'));
		});

		// setOrigin takes Hearth's origin from the plugin options.
		function setOrigin(o) { origin = typeof o === 'string' ? o : ''; }

		// ready says whether Hearth can be asked.
		function ready() { return !!origin && window.top !== window; }

		// request sends op and resolves with Hearth's answer. options:
		//   timeoutMs  the longest wait for the end (default 30 s); a
		//              streamed answer resets it with every piece
		//   onPart     called with each piece of a streamed answer
		//   signal     an AbortSignal: aborting tells Hearth to stop
		function request(op, args, options) {
			const o = options || {};
			if (!ready()) return Promise.reject(new Error('Open the document from Hearth to use this.'));
			const id = next++;
			const wait = o.timeoutMs || 30000;
			return new Promise(function (resolve, reject) {
				const p = { resolve: resolve, reject: reject, timer: 0, onPart: null };
				const expire = function () {
					if (!pending.has(id)) return;
					pending.delete(id);
					reject(new Error('Hearth did not answer.'));
				};
				p.timer = setTimeout(expire, wait);
				if (o.onPart) {
					p.onPart = function (part) {
						clearTimeout(p.timer);
						p.timer = setTimeout(expire, wait);
						o.onPart(part);
					};
				}
				pending.set(id, p);
				window.top.postMessage({ hearth: channel, id: id, op: op, args: args || {} }, origin);
				if (o.signal) {
					o.signal.addEventListener('abort', function () {
						if (!pending.has(id)) return;
						pending.delete(id);
						clearTimeout(p.timer);
						window.top.postMessage({ hearth: channel, id: id, op: 'cancel' }, origin);
						reject(new DOMException('Stopped', 'AbortError'));
					}, { once: true });
				}
			});
		}

		// ask is request without streaming (the older form).
		function ask(op, args, timeoutMs) { return request(op, args, { timeoutMs: timeoutMs }); }

		return { setOrigin: setOrigin, ready: ready, request: request, ask: ask };
	}

	window.HearthBridge = { create: create };
})(window);
