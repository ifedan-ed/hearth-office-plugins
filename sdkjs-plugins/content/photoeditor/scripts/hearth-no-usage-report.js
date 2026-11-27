// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The TOAST UI libraries this plugin uses (image editor, colour picker,
// code snippet) report each use to Google Analytics unless the global
// window.tui.usageStatistics is false; the plugin turns the image
// editor's own report off, but the colour picker it makes still reported
// (Hearth's office-ai.spec.ts saw www.google-analytics.com in the request
// log). Loaded after the libraries, before the editor is made: nothing is
// sent anywhere.
(function (window) {
	'use strict';
	window.tui = window.tui || {};
	window.tui.usageStatistics = false;
})(window);
