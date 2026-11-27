// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// A side panel follows the editor's colours: the theme's named colours
// become custom properties (panel.css reads them), so the panel follows
// light, dark and any theme the host adds. Each panel calls follow() once.
(function (window, document) {
	'use strict';

	function apply(theme) {
		if (!theme) return;
		Object.keys(theme).forEach(function (name) {
			if (typeof theme[name] === 'string' && /^[a-z0-9-]+$/i.test(name)) document.documentElement.style.setProperty('--' + name, theme[name]);
		});
	}

	// follow applies the theme the editor names now and every later one,
	// whether it comes from the editor or by way of the background page.
	function follow() {
		window.Asc.plugin.attachEvent('onThemeChanged', apply);
		window.Asc.plugin.onThemeChanged = function (theme) {
			window.Asc.plugin.onThemeChangedBase(theme);
			apply(theme);
		};
	}

	window.HearthTheme = { apply: apply, follow: follow };
})(window, document);
