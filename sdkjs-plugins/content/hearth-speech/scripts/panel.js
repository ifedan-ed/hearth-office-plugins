// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The panel shows what Speech input is doing and the words still
// being heard; Stop goes to the background page.
(function () {
	'use strict';
	var el = function (id) { return document.getElementById(id); };
	var words = { starting: 'Starting the microphone', listening: 'Listening', stopping: 'Finishing', idle: 'Stopped' };
	window.Asc.plugin.init = function () {
		window.Asc.plugin.attachEvent('onState', function (s) {
			el('state').textContent = words[s] || s;
			el('state').className = s === 'listening' ? 'on' : '';
			el('stop').disabled = s === 'idle';
		});
		window.Asc.plugin.attachEvent('onInterim', function (t) { el('interim').textContent = t || ''; });
		window.Asc.plugin.attachEvent('onProblem', function (t) { el('problem').textContent = t; el('problem').hidden = !t; });
		window.HearthTheme.follow();
		window.Asc.plugin.sendToPlugin('onPanelReady');
	};
	el('stop').addEventListener('click', function () { window.Asc.plugin.sendToPlugin('onStop'); });
})();
