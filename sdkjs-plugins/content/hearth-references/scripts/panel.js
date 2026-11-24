// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The side panel's behaviour. Searching goes to Hearth (bridge.js): the
// person's libraries answer at once, PubMed a moment later, each result
// marked by where it came from and a paper in both shown once (as the
// library's). Picked papers make the citation being written; each can
// have a page (locator), a prefix, a suffix, and its author left out.
// Insert and Save hand the citation to the background page, which changes
// the document. Nothing is inserted unless the person presses Insert.
(function (window, document) {
	'use strict';

	const bridge = window.HearthRefs.bridge;
	const el = function (id) { return document.getElementById(id); };
	const send = function (name, data) { window.Asc.plugin.sendToPlugin(name, data); };

	let mode = 'cite';     // cite, edit, list or style
	let editing = null;    // the citation being edited: { id, items }
	let cluster = [];      // [{ item: {id, uri, csl} | null, pmid, key, title, sub, locator, prefix, suffix, suppressAuthor }]
	let styleID = '';
	let styles = null;
	let searchSeq = 0;

	function problem(text) {
		el('problem').textContent = text || '';
		el('problem').hidden = !text;
	}

	function status(text) {
		el('status').textContent = text || '';
		el('status').hidden = !text;
		if (text) setTimeout(function () { if (el('status').textContent === text) status(''); }, 3000);
	}

	function node(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function show(view) {
		mode = view;
		const tab = view === 'edit' ? 'cite' : view;
		['cite', 'list', 'style'].forEach(function (v) {
			el('view-' + v).hidden = v !== tab;
			el('tab-' + v).setAttribute('aria-selected', v === tab ? 'true' : 'false');
		});
		if (tab === 'style') loadStyles();
		if (tab === 'cite') el('search').focus();
	}

	// --- Searching ------------------------------------------------------

	function authorsOf(csl) {
		const a = (csl.author || csl.editor || []).slice(0, 3).map(function (n) { return n.family || n.literal || ''; }).filter(Boolean);
		return a.join(', ') + ((csl.author || []).length > 3 ? ' et al.' : '');
	}
	function yearOf(csl) {
		const d = csl.issued && csl.issued['date-parts'] && csl.issued['date-parts'][0];
		return d && d[0] ? String(d[0]) : '';
	}

	async function search(q) {
		const seq = ++searchSeq;
		const box = el('results');
		box.innerHTML = '';
		if (!q.trim()) return;
		const libPart = node('section', 'group');
		libPart.appendChild(node('h2', '', 'Your libraries'));
		const libList = node('ul', 'list');
		libPart.appendChild(libList);
		const pmPart = node('section', 'group');
		pmPart.appendChild(node('h2', '', 'PubMed'));
		const pmList = node('ul', 'list');
		pmList.appendChild(node('li', 'muted', 'Searching…'));
		pmPart.appendChild(pmList);
		box.appendChild(libPart);
		box.appendChild(pmPart);
		const seen = new Set();
		try {
			const lib = await bridge.ask('search', { q: q });
			if (seq !== searchSeq) return;
			if (!lib.length) libList.appendChild(node('li', 'muted', 'Nothing in your libraries'));
			lib.forEach(function (r) {
				if (r.pmid) seen.add('pmid:' + r.pmid);
				if (r.doi) seen.add('doi:' + r.doi.toLowerCase());
				libList.appendChild(result({ item: { id: r.id, uri: r.uri, csl: r.csl }, key: r.uri, title: r.title, sub: [r.authors, r.container, r.year].filter(Boolean).join(' · '), source: 'Library' }));
			});
		} catch (e) {
			if (seq === searchSeq) libList.appendChild(node('li', 'error', e.message));
		}
		try {
			const pm = await bridge.ask('pubmed', { q: q }, 45000);
			if (seq !== searchSeq) return;
			pmList.innerHTML = '';
			const shown = pm.papers.filter(function (p) { return !seen.has('pmid:' + p.pmid) && !(p.doi && seen.has('doi:' + p.doi)); });
			if (!shown.length) pmList.appendChild(node('li', 'muted', 'No other papers in PubMed'));
			shown.forEach(function (p) {
				pmList.appendChild(result({ item: null, pmid: p.pmid, key: 'pmid:' + p.pmid, title: p.title,
					sub: [(p.authors || []).slice(0, 3).join(', ') + ((p.authors || []).length > 3 ? ' et al.' : ''), p.journal, p.year].filter(Boolean).join(' · '),
					source: p.records.length ? 'In your library' : 'PubMed' }));
			});
		} catch (e) {
			if (seq !== searchSeq) return;
			pmList.innerHTML = '';
			pmList.appendChild(node('li', 'error', e.message));
		}
	}

	function result(r) {
		const li = node('li', 'result');
		const text = node('div', 'text');
		text.appendChild(node('span', 'title', r.title || '(no title)'));
		text.appendChild(node('span', 'sub', r.sub));
		const tag = node('span', 'source', r.source);
		text.appendChild(tag);
		const add = node('button', 'add', 'Add');
		add.type = 'button';
		add.setAttribute('aria-label', 'Add to the citation: ' + (r.title || ''));
		add.addEventListener('click', function () { pick(r); });
		li.appendChild(text);
		li.appendChild(add);
		return li;
	}

	function pick(r) {
		if (cluster.some(function (c) { return c.key === r.key; })) return;
		cluster.push({ item: r.item, pmid: r.pmid, key: r.key, title: r.title, sub: r.sub, locator: '', prefix: '', suffix: '', suppressAuthor: false });
		drawCluster();
	}

	// --- The citation being made or edited ------------------------------

	function drawCluster() {
		el('cluster').hidden = cluster.length === 0 && !editing;
		el('cluster-title').textContent = editing ? 'Edit citation' : 'Citation';
		el('insert').textContent = editing ? 'Save' : 'Insert';
		el('insert').disabled = cluster.length === 0;
		const list = el('cluster-items');
		list.innerHTML = '';
		cluster.forEach(function (c, i) {
			const li = node('li', 'picked');
			const head = node('div', 'head');
			head.appendChild(node('span', 'title', c.title || '(no title)'));
			const rm = node('button', 'icon', '×');
			rm.type = 'button';
			rm.setAttribute('aria-label', 'Remove from the citation');
			rm.addEventListener('click', function () { cluster.splice(i, 1); drawCluster(); });
			head.appendChild(rm);
			li.appendChild(head);
			const more = node('div', 'more');
			[['locator', 'Page'], ['prefix', 'Prefix'], ['suffix', 'Suffix']].forEach(function (f) {
				const lab = node('label');
				lab.appendChild(node('span', '', f[1]));
				const input = node('input');
				input.value = c[f[0]];
				input.addEventListener('input', function () { c[f[0]] = input.value; });
				lab.appendChild(input);
				more.appendChild(lab);
			});
			const sup = node('label', 'check');
			const box = node('input');
			box.type = 'checkbox';
			box.checked = c.suppressAuthor;
			box.addEventListener('change', function () { c.suppressAuthor = box.checked; });
			sup.appendChild(box);
			sup.appendChild(node('span', '', 'Leave out the author'));
			more.appendChild(sup);
			li.appendChild(more);
			list.appendChild(li);
		});
	}

	// commit adds the PubMed papers to the library (each becomes a record
	// of the person's own library), then hands the citation over.
	async function commit() {
		problem('');
		const fromPubMed = cluster.filter(function (c) { return !c.item && c.pmid; });
		if (fromPubMed.length) {
			el('insert').disabled = true;
			try {
				const added = await bridge.ask('addPubMed', { pmids: fromPubMed.map(function (c) { return c.pmid; }) }, 45000);
				fromPubMed.forEach(function (c) {
					const a = added.find(function (x) { return x.pmid === c.pmid; });
					if (a) c.item = { id: a.id, uri: a.uri, csl: a.csl };
				});
			} catch (e) {
				problem(e.message);
				el('insert').disabled = false;
				return;
			}
		}
		const items = cluster.filter(function (c) { return c.item; }).map(function (c) {
			return { item: c.item, locator: c.locator.trim(), prefix: c.prefix, suffix: c.suffix, suppressAuthor: c.suppressAuthor };
		});
		if (editing) send('onEdit', { id: editing.id, items: items });
		else send('onInsert', items);
	}

	// startEdit fills the citation from the one the cursor is in.
	async function startEdit(current) {
		editing = current;
		cluster = [];
		if (current) {
			try {
				const got = await bridge.ask('resolve', { uris: current.items.map(function (i) { return i.key; }) });
				current.items.forEach(function (i) {
					const r = got[i.key];
					cluster.push({ item: r ? { id: r.id, uri: r.uri, csl: r.csl } : { id: i.key, uri: i.key, csl: i.csl || { title: i.title } },
						key: i.key, title: i.title, sub: [i.author, i.year].filter(Boolean).join(' · '),
						locator: i.locator, prefix: i.prefix, suffix: i.suffix, suppressAuthor: i.suppressAuthor });
				});
			} catch (e) {
				problem(e.message);
			}
		} else {
			problem('Put the cursor in a citation to edit it.');
		}
		drawCluster();
	}

	// --- The document's citations -------------------------------------

	function drawDocument(list) {
		const ol = el('doc-list');
		ol.innerHTML = '';
		el('doc-empty').hidden = list.length > 0;
		list.forEach(function (c) {
			const li = node('li');
			const b = node('button', 'doc-item');
			b.type = 'button';
			b.appendChild(node('span', 'mark', c.text || '…'));
			b.appendChild(node('span', 'sub', c.kind === 'bibliography' ? 'Bibliography' : (c.items || []).map(function (i) { return [i.author, i.year].filter(Boolean).join(' '); }).join('; ')));
			b.addEventListener('click', function () { send('onSelect', c.id); });
			li.appendChild(b);
			ol.appendChild(li);
		});
	}

	// --- Styles ----------------------------------------------------------

	async function loadStyles() {
		if (!styles) {
			try {
				styles = await bridge.ask('styles', {});
			} catch (e) {
				problem(e.message);
				return;
			}
		}
		drawStyles();
	}

	function drawStyles() {
		const q = el('style-filter').value.trim().toLowerCase();
		const ul = el('styles');
		ul.innerHTML = '';
		(styles || []).filter(function (s) { return !q || s.title.toLowerCase().indexOf(q) >= 0; }).forEach(function (s) {
			const li = node('li');
			const lab = node('label');
			const r = node('input');
			r.type = 'radio';
			r.name = 'style';
			r.checked = s.id === styleID;
			r.addEventListener('change', function () {
				styleID = s.id;
				status('Applying ' + s.title + '…');
				send('onStyle', s.id);
			});
			lab.appendChild(r);
			const t = node('span', 'style-title', s.title);
			lab.appendChild(t);
			lab.appendChild(node('span', 'sub', s.kind === 'numeric' ? 'Numbered' : s.kind === 'note' ? 'Footnotes' : 'Author, year'));
			li.appendChild(lab);
			ul.appendChild(li);
		});
	}

	// --- Messages from the background page -------------------------------

	window.Asc.plugin.init = function () {
		el('tab-cite').addEventListener('click', function () { show('cite'); });
		el('tab-list').addEventListener('click', function () { show('list'); });
		el('tab-style').addEventListener('click', function () { show('style'); });
		let t = 0;
		el('search').addEventListener('input', function () {
			clearTimeout(t);
			const q = el('search').value;
			t = setTimeout(function () { search(q); }, 300);
		});
		el('search-form').addEventListener('submit', function (e) { e.preventDefault(); search(el('search').value); });
		el('insert').addEventListener('click', commit);
		el('cancel').addEventListener('click', function () { cluster = []; editing = null; drawCluster(); });
		el('refresh').addEventListener('click', function () { send('onRefresh'); });
		el('unlink').addEventListener('click', function () { el('unlink-ask').hidden = false; });
		el('unlink-no').addEventListener('click', function () { el('unlink-ask').hidden = true; });
		el('unlink-yes').addEventListener('click', function () { el('unlink-ask').hidden = true; send('onUnlink'); });
		el('style-filter').addEventListener('input', drawStyles);
		send('onPanelReady');
	};

	window.Asc.plugin.attachEvent('onSetup', function (s) {
		bridge.setOrigin(s.origin);
		styleID = s.style;
		el('odt').hidden = !s.odt;
		show(s.mode === 'edit' ? 'cite' : s.mode);
		if (s.mode === 'edit') startEdit(s.current);
	});
	window.Asc.plugin.attachEvent('onMode', function (m) {
		show(m.mode === 'edit' ? 'cite' : m.mode);
		if (m.mode === 'edit') startEdit(m.current);
	});
	window.Asc.plugin.attachEvent('onDocument', drawDocument);
	window.Asc.plugin.attachEvent('onProblem', function (text) { problem(text); el('insert').disabled = cluster.length === 0; });
	window.Asc.plugin.attachEvent('onDone', function (what) {
		const words = { inserted: 'Citation inserted', edited: 'Citation saved', styled: 'Style applied', refreshed: 'Citations updated', current: 'Citations are up to date' };
		status(words[what] || '');
		if (what === 'inserted' || what === 'edited') {
			cluster = [];
			editing = null;
			drawCluster();
		}
	});
	window.Asc.plugin.attachEvent('onThemeChanged', function (theme) { window.Asc.plugin.onThemeChangedBase(theme); });
})(window, document);
