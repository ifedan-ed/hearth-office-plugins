// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The Thesaurus panel: the word, the language pack, and the word's
// meanings with their synonyms. A synonym's button puts it in place of
// the word (the background page does the change); the field looks up any
// other word. The data are the image's own (data/), fetched from the
// Document Server, never from anywhere else.
(function (window, document) {
	'use strict';

	const lookup = window.HearthThesaurus.lookup;
	const el = function (id) { return document.getElementById(id); };
	const send = function (name, data) { window.Asc.plugin.sendToPlugin(name, data); };
	const PACK_KEY = 'hearth-thesaurus-pack';

	let packs = null;

	function say(id, text) {
		el(id).textContent = text || '';
		el(id).hidden = !text;
	}

	async function loadPacks() {
		if (packs) return packs;
		const r = await fetch('data/packs.json');
		if (!r.ok) throw new Error('No thesaurus is installed.');
		packs = await r.json();
		const select = el('pack');
		let kept = '';
		try { kept = window.localStorage.getItem(PACK_KEY) || ''; } catch (e) { kept = ''; }
		packs.forEach(function (p) { select.appendChild(new Option(p.name, p.code, false, p.code === kept)); });
		select.hidden = packs.length < 2;
		return packs;
	}

	function base() { return 'data/' + (el('pack').value || (packs[0] && packs[0].code)) + '/'; }

	async function show(word) {
		el('word').value = word || '';
		el('meanings').innerHTML = '';
		say('problem', '');
		say('state', '');
		if (!word) return;
		try {
			await loadPacks();
			const found = await lookup.find(base(), word);
			if (!found) { say('state', 'No synonyms for “' + word + '”.'); return; }
			if (found.word.toLowerCase() !== word.toLowerCase()) say('state', 'Synonyms for “' + found.word + '”');
			found.meanings.forEach(function (m) {
				const box = document.createElement('div');
				box.className = 'meaning';
				const h = document.createElement('h2');
				h.textContent = m[0] || 'meaning';
				box.appendChild(h);
				const words = document.createElement('div');
				words.className = 'words';
				m[1].forEach(function (syn) {
					const b = document.createElement('button');
					b.type = 'button';
					b.textContent = syn;
					b.title = 'Replace with “' + syn + '”';
					b.addEventListener('click', function () { send('onPick', syn); });
					words.appendChild(b);
				});
				box.appendChild(words);
				el('meanings').appendChild(box);
			});
		} catch (e) {
			say('problem', e.message);
		}
	}


	window.Asc.plugin.init = function () {
		window.Asc.plugin.attachEvent('onWord', show);
		window.Asc.plugin.attachEvent('onPicked', function () { say('state', ''); });
		window.Asc.plugin.attachEvent('onProblem', function (t) { say('problem', t); });
		window.HearthTheme.follow();
		send('onPanelReady');
	};

	el('find').addEventListener('submit', function (e) { e.preventDefault(); show(el('word').value.trim()); });
	el('pack').addEventListener('change', function () {
		try { window.localStorage.setItem(PACK_KEY, el('pack').value); } catch (e) { /* kept nowhere */ }
		show(el('word').value.trim());
	});
})(window, document);
