// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The background page of References: the toolbar tab (named Citations:
// the editor has a References tab of its own, for contents and notes),
// the side panel,
// and every change to the document. The panel (panel.html) searches and
// shows; only this page reads or changes the document (document.js,
// citations.js), so two changes never race.
(function (window) {
	'use strict';

	const R = window.HearthRefs;
	const TAB = 'hearth_references';

	let panel = null;
	let panelReady = false;
	let wanted = 'cite';
	let busy = Promise.resolve();
	let odt = false;

	function say(name, data) {
		if (panel && panelReady) panel.command(name, data);
	}

	// serial runs document changes one after another.
	function serial(fn) {
		busy = busy.then(fn, fn).catch(function (e) {
			console.error('References:', e);
			say('onProblem', String(e && e.message || e));
		});
		return busy;
	}

	async function documentCitations() {
		const all = await R.doc.fields();
		const out = [];
		for (const f of all) {
			if (f.kind === 'bibliography') {
				out.push({ id: f.id, kind: 'bibliography', text: 'Bibliography' });
				continue;
			}
			const c = R.fields.parseCitation(f.value);
			if (!c) continue;
			out.push({
				id: f.id, kind: 'citation', text: f.content || (c.properties && c.properties.plainCitation) || '',
				items: c.citationItems.map(function (ci) {
					const d = ci.itemData || {};
					const y = d.issued && d.issued['date-parts'] && d.issued['date-parts'][0] && d.issued['date-parts'][0][0];
					const a = d.author && d.author[0] ? (d.author[0].family || d.author[0].literal || '') : '';
					return { key: R.fields.itemKey(ci), title: d.title || '', author: a, year: y || '', locator: ci.locator || '', prefix: ci.prefix || '', suffix: ci.suffix || '', suppressAuthor: !!ci['suppress-author'] };
				}),
			});
		}
		return out;
	}

	async function setup() {
		const st = await R.citations.style();
		say('onSetup', { mode: wanted, origin: (window.Asc.plugin.info.options || {}).hearthOrigin || '', style: st.styleID, odt: odt, current: await currentCitation() });
		say('onDocument', await documentCitations());
	}

	async function currentCitation() {
		const f = await R.doc.current();
		if (!f || f.kind !== 'citation') return null;
		const list = await documentCitations();
		return list.find(function (x) { return x.id === f.id; }) || null;
	}

	function openPanel(mode) {
		wanted = mode;
		if (panel) {
			serial(async function () { say('onMode', { mode: mode, current: await currentCitation() }); });
			return;
		}
		panel = new window.Asc.PluginWindow();
		panel.attachEvent('onPanelReady', function () {
			panelReady = true;
			serial(setup);
		});
		panel.attachEvent('onInsert', function (items) {
			serial(async function () {
				await R.citations.insertCitation(items);
				say('onDone', 'inserted');
				say('onDocument', await documentCitations());
			});
		});
		panel.attachEvent('onEdit', function (x) {
			serial(async function () {
				const all = await R.doc.fields();
				const f = all.find(function (y) { return y.id === x.id; });
				if (!f) return;
				await R.citations.editCitation(f.id, f.value, x.items);
				say('onDone', 'edited');
				say('onDocument', await documentCitations());
			});
		});
		panel.attachEvent('onSelect', function (id) { serial(function () { return R.doc.select(id); }); });
		panel.attachEvent('onStyle', function (styleID) {
			serial(async function () {
				const st = await R.citations.style();
				await R.citations.setStyle(styleID, true, st.session);
				await R.citations.refresh();
				say('onDone', 'styled');
				say('onDocument', await documentCitations());
			});
		});
		panel.attachEvent('onRefresh', function () { serial(refresh); });
		// Turning every citation into plain text: offered in the panel, where
		// the person confirms it.
		panel.attachEvent('onUnlink', function () { serial(unlink); });
		panel.attachEvent('onWindowClose', function () {
			panel.close();
			panel = null;
			panelReady = false;
		});
		panel.show({
			url: 'panel.html', description: 'References', isVisual: true, isModal: false, buttons: [],
			type: 'panelRight', dockedPlace: 'panelRight', isCanDocked: true, EditorsSupport: ['word'], size: [360, 560],
		});
	}

	async function refresh() {
		const r = await R.citations.refresh();
		say('onDone', r.changed ? 'refreshed' : 'current');
		say('onDocument', await documentCitations());
	}

	async function bibliography() {
		await R.citations.insertBibliography();
		say('onDocument', await documentCitations());
	}

	async function unlink() {
		const all = await R.doc.fields();
		await R.doc.unlink(all.map(function (f) { return f.id; }));
		say('onDocument', []);
	}

	window.Asc.plugin.init = function () {
		const info = window.Asc.plugin.info;
		const options = info.options || {};
		// Hearth turns the tab off for a link's visitor (no library), and
		// any other host gives no origin: no tab then.
		if (options.off || !options.hearthOrigin) return;
		R.bridge.setOrigin(options.hearthOrigin);
		odt = /\.(odt|ott|fodt)$/i.test(info.documentTitle || '');
		const items = [
			{ id: 'cite', text: 'Insert citation', hint: 'Cite from your library or PubMed', icon: 'cite' },
			{ id: 'edit', text: 'Edit citation', hint: 'Change the citation the cursor is in', icon: 'edit' },
			{ id: 'bibliography', text: 'Bibliography', hint: 'Insert or update the bibliography', icon: 'bibliography' },
			{ id: 'refresh', text: 'Refresh', hint: 'Format every citation again', icon: 'refresh' },
			{ id: 'style', text: 'Style', hint: 'The citation style for the whole document', icon: 'style' },
			{ id: 'list', text: 'Citation list', hint: 'The citations in this document', icon: 'list', separator: true },
		].map(function (b) {
			return {
				id: 'hearth_refs_' + b.id, type: 'big-button', text: b.text, hint: b.hint,
				icons: 'resources/icons/%theme-type%(light|dark)/' + b.icon + '.svg',
				lockInViewMode: true, enableToggle: false, separator: !!b.separator,
			};
		});
		window.Asc.plugin.executeMethod('AddToolbarMenuItem', [{ guid: window.Asc.plugin.guid, tabs: [{ id: TAB, text: 'Citations', items: items }] }]);
	};

	window.Asc.plugin.event_onToolbarMenuClick = function (id) {
		const what = id.replace('hearth_refs_', '');
		switch (what) {
			case 'cite': case 'edit': case 'style': case 'list':
				openPanel(what);
				break;
			case 'bibliography':
				serial(bibliography);
				break;
			case 'refresh':
				serial(refresh);
				break;
		}
	};

	window.Asc.plugin.onThemeChanged = function (theme) {
		window.Asc.plugin.onThemeChangedBase(theme);
		say('onThemeChanged', theme);
	};

	window.Asc.plugin.button = function () {};
})(window);
