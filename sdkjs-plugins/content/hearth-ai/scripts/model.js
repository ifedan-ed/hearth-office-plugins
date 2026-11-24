// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The one way to a language model: the Document Server's own proxy
// (/ai-proxy), which adds the key on the server and forwards the request to
// the provider in its settings (for Hearth: LiteLLM). The browser never holds
// a key and never talks to a provider.
//
// The model is one explicit setting, aiSettings.actions.Chat.model in the
// server's settings file. There is no settings screen here and no second
// choice: without that setting the assistant says it is not set up.
(function (window) {
	'use strict';

	const HearthAI = window.HearthAI = window.HearthAI || {};

	// Filled by configure(): where to send requests and which model to name.
	let route = null;

	// configure reads the settings the editor hands to the plugin (the
	// server's aiSettings with the keys blanked, plus the proxy's address).
	// It returns nothing; ready() says whether a model can be reached.
	function configure(settingsJson) {
		route = null;
		let settings;
		try { settings = JSON.parse(settingsJson || 'null'); } catch (e) { settings = null; }
		const model = settings && settings.actions && settings.actions.Chat && settings.actions.Chat.model;
		if (!settings || !settings.proxy || !model) return;
		const entry = (settings.models || []).find(function (m) { return m.id === model; });
		const provider = entry && settings.providers && settings.providers[entry.provider];
		if (!provider || !provider.url) return;
		const base = provider.url.replace(/\/+$/, '') + (provider.addon ? '/' + provider.addon.replace(/^\/+|\/+$/g, '') : '');
		route = { proxy: settings.proxy, target: base + '/chat/completions', model: model };
	}

	function ready() { return route !== null; }

	// chat sends one request and resolves with the whole answer. onDelta, when
	// given, is called with each piece of text as it arrives, so a person sees
	// the answer being written. signal cancels the request.
	//
	// The proxy wants the real request wrapped: the provider's address, the
	// method, the headers and the body as a string. It checks the editing
	// session's token (Authorization) before it forwards anything, so only a
	// person with the document open can use the model.
	async function chat(request) {
		if (!route) throw new Error('not-configured');
		const body = {
			model: route.model,
			stream: true,
			temperature: request.temperature === undefined ? 0.3 : request.temperature,
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.user },
			],
		};
		const response = await fetch(route.proxy, {
			method: 'POST',
			signal: request.signal,
			headers: { Authorization: 'Bearer ' + window.Asc.plugin.info.jwt },
			body: JSON.stringify({
				target: route.target,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(body),
			}),
		});
		if (!response.ok || !response.body) {
			throw new Error('model-error ' + response.status + ' ' + (await response.text().catch(function () { return ''; })).slice(0, 200));
		}
		return readStream(response.body, request.onDelta);
	}

	// readStream collects a server-sent-events answer in the OpenAI shape:
	// lines of "data: {json}", ended by "data: [DONE]". A line can be cut in
	// two by the network, so the unfinished tail is kept for the next chunk.
	async function readStream(stream, onDelta) {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let pending = '', answer = '';
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			pending += decoder.decode(chunk.value, { stream: true });
			const lines = pending.split('\n');
			pending = lines.pop();
			for (const line of lines) {
				const piece = deltaOf(line);
				if (!piece) continue;
				answer += piece;
				if (onDelta) onDelta(piece);
			}
		}
		return answer;
	}

	// deltaOf returns the text one stream line carries, or '' for keep-alive
	// lines, the end marker, reasoning-only chunks and anything unreadable.
	function deltaOf(line) {
		const text = line.trim();
		if (!text.startsWith('data:')) return '';
		const payload = text.slice(5).trim();
		if (!payload || payload === '[DONE]') return '';
		try {
			const choice = JSON.parse(payload).choices[0];
			return (choice && choice.delta && choice.delta.content) || '';
		} catch (e) {
			return '';
		}
	}

	HearthAI.model = { configure: configure, ready: ready, chat: chat };
})(window);
