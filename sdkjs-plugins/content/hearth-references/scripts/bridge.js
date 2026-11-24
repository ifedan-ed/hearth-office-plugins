// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The way to Hearth. The editor runs inside a frame of Hearth's own page
// (Hearth Office is opened only from there), and that page is the window
// at the top. This page asks it by message: search the person's library and
// PubMed, add a paper, format citations with a citation style. Hearth does
// the work with the person's own session, through its ordinary API, so the
// add-in holds no token and needs no rule of its own on Hearth's side, and
// citeproc and the styles are loaded once, by Hearth, not by every add-in
// page.
//
// Hearth's address comes with the editor's settings (the plugin options,
// "hearthOrigin"); requests go only there and answers are taken only from
// there. Hearth checks in turn that a request comes from the editor's
// origin.
(function (window) {
	'use strict';

	const pending = new Map();
	let next = 1;
	let origin = '';

	window.addEventListener('message', function (e) {
		const m = e.data;
		if (!origin || e.origin !== origin || !m || m.hearth !== 'references' || !pending.has(m.id)) return;
		const p = pending.get(m.id);
		pending.delete(m.id);
		if (m.ok) p.resolve(m.result);
		else p.reject(new Error(m.error || 'Hearth could not do this.'));
	});

	// setOrigin takes Hearth's origin from the plugin options.
	function setOrigin(o) {
		origin = typeof o === 'string' ? o : '';
	}

	// ready says whether Hearth can be asked.
	function ready() {
		return !!origin && window.top !== window;
	}

	// ask sends one request and resolves with Hearth's answer. timeoutMs
	// bounds the wait (PubMed may be slow; formatting a long document too).
	function ask(op, args, timeoutMs) {
		if (!ready()) return Promise.reject(new Error('Open the document from Hearth to use References.'));
		const id = next++;
		return new Promise(function (resolve, reject) {
			pending.set(id, { resolve: resolve, reject: reject });
			window.top.postMessage({ hearth: 'references', id: id, op: op, args: args || {} }, origin);
			setTimeout(function () {
				if (!pending.has(id)) return;
				pending.delete(id);
				reject(new Error('Hearth did not answer.'));
			}, timeoutMs || 30000);
		});
	}

	window.HearthRefs = window.HearthRefs || {};
	window.HearthRefs.bridge = { setOrigin: setOrigin, ready: ready, ask: ask };
})(window);
