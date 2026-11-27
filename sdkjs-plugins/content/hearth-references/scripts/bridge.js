// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// References' line to Hearth: the shared bridge (../hearth-shared/
// bridge.js) on the "references" channel. Hearth searches the person's
// library and PubMed, adds papers and formats citations with citeproc,
// with the person's own session.
(function (window) {
	'use strict';
	window.HearthRefs = window.HearthRefs || {};
	window.HearthRefs.bridge = window.HearthBridge.create('references');
})(window);
