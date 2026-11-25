// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// What the host told the plugin, through the plugin options
// (window.Asc.plugin.info.options). Hearth keeps the person's Zotero API
// key in its own Office settings (the one place it is kept) and passes it
// here for a signed-in person:
//
//   {"hearth": true, "apiKey": "<key>"}  use this key, in memory only
//   {"hearth": true}                     no key set: say where to set it
//   {"off": true}                        a link's visitor: no Zotero
//
// Any other host gives none of these, and the plugin keeps its own sign-in
// (the key typed into the plugin).

// @ts-check

/**
 * @typedef {Object} HostMode
 * @property {"plugin"|"off"|"hearth-key"|"hearth-no-key"} mode
 * @property {string} apiKey - set for "hearth-key" only
 */

/**
 * hostMode reads the plugin options.
 * @param {any} options - window.Asc.plugin.info.options
 * @returns {HostMode}
 */
function hostMode(options) {
    const o = options && typeof options === "object" ? options : {};
    if (o.off === true) return { mode: "off", apiKey: "" };
    if (o.hearth === true) {
        const key = typeof o.apiKey === "string" ? o.apiKey.trim() : "";
        return key ? { mode: "hearth-key", apiKey: key } : { mode: "hearth-no-key", apiKey: "" };
    }
    return { mode: "plugin", apiKey: "" };
}

export { hostMode };
