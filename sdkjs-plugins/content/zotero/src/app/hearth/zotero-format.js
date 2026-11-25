// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Zotero's own format for citations in Word documents, as this plugin
// writes it: the same as Zotero's Word plugin and Hearth's References tab
// (hearth-references/scripts/fields.js), so a paper stays live in all three.
//
//   a citation      ZOTERO_ITEM CSL_CITATION {citation JSON}
//   a bibliography  ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY
//   the style       document properties ZOTERO_PREF_1, _2, ... (one XML
//                   text cut into pieces of 255 characters)
//
// The field's Value as the plugin API sees it has no "ADDIN " (the editor
// adds it). Older documents (ZOTERO_CITATION, ZOTERO_BIBLIOGRAPHY, no space
// before the JSON) are still read.
//
// Pure functions only: no editor, no network, so .tests/ can run them.

// @ts-check

const SCHEMA =
    "https://github.com/citation-style-language/schema/raw/master/csl-citation.json";
const CITATION = "ZOTERO_ITEM CSL_CITATION ";
const BIBLIOGRAPHY = "ZOTERO_BIBL ";
const BIBLIOGRAPHY_END = " CSL_BIBLIOGRAPHY";
const EMPTY_BIBLIOGRAPHY = '{"uncited":[],"omitted":[],"custom":[]}';
// Zotero's preference pieces are at most 255 characters each.
const PREF_CHUNK = 255;
const STYLE_BASE = "http://www.zotero.org/styles/";

/**
 * fieldKind tells what an add-in field is: "citation", "bibliography" or
 * "" (another plugin's field, left alone).
 * @param {string} value
 * @returns {"citation"|"bibliography"|""}
 */
function fieldKind(value) {
    const v = String(value || "").replace(/^\s*ADDIN\s+/, "");
    if (/^ZOTERO_(ITEM|CITATION)\b/.test(v)) return "citation";
    if (/^ZOTERO_(BIBL|BIBLIOGRAPHY)\b/.test(v)) return "bibliography";
    return "";
}

/**
 * citationValue writes a citation's Value as Zotero does: one space
 * between the marker and the JSON.
 * @param {object} citation - the citation JSON (citationID, properties,
 *   citationItems, schema)
 * @returns {string}
 */
function citationValue(citation) {
    return CITATION + JSON.stringify(citation);
}

/**
 * bibliographyValue is a bibliography field's Value. Its JSON part is
 * Zotero's (items added or left out by hand): an existing one is kept,
 * a new or unreadable one is Zotero's empty one.
 * @param {string} [old] - the field's current Value
 * @returns {string}
 */
function bibliographyValue(old) {
    let json = EMPTY_BIBLIOGRAPHY;
    const v = String(old || "");
    const a = v.indexOf("{");
    const b = v.lastIndexOf("}");
    if (a >= 0 && b > a) {
        try {
            const parsed = JSON.parse(v.slice(a, b + 1));
            if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
                json = JSON.stringify(parsed);
            }
        } catch (e) {
            // A broken one is replaced by the empty one.
        }
    }
    return BIBLIOGRAPHY + json + BIBLIOGRAPHY_END;
}

/**
 * canonicalUri turns a Zotero web API link to an item into the item URI
 * Zotero desktop recognises (http://zotero.org/users/<id>/items/<key>,
 * groups likewise). Any other URI is returned as it is.
 * @param {string} uri
 * @returns {string}
 */
function canonicalUri(uri) {
    const m =
        /^https?:\/\/(?:api\.|www\.)?zotero\.org\/(users|groups)\/(\d+)\/items\/([A-Z0-9]+)(?:[/?#].*)?$/i.exec(
            String(uri || ""),
        );
    if (!m) return String(uri || "");
    return "http://zotero.org/" + m[1].toLowerCase() + "/" + m[2] + "/items/" + m[3];
}

/**
 * canonicalUris is an item's URIs for the document: API links made
 * canonical, duplicates removed, and the web page links
 * (www.zotero.org/<username>/items/<key>, which identify nothing for
 * Zotero) dropped when the same item has a canonical URI. When there is
 * no canonical URI and the library is known, one is made from it.
 * @param {Array<string>} uris
 * @param {{userID?: string|number, groupID?: string|number, key?: string|number}} [library]
 * @returns {Array<string>}
 */
function canonicalUris(uris, library) {
    /** @type {Array<string>} */
    const out = [];
    (uris || []).forEach(function (u) {
        const c = canonicalUri(u);
        if (c && out.indexOf(c) === -1) out.push(c);
    });
    const isCanonical = function (/** @type {string} */ u) {
        return /^http:\/\/zotero\.org\/(users|groups)\/\d+\/items\/[A-Z0-9]+$/i.test(u);
    };
    if (!out.some(isCanonical) && library && library.key) {
        const key = String(library.key);
        if (/^[A-Z0-9]{8}$/.test(key)) {
            if (library.groupID) out.unshift("http://zotero.org/groups/" + library.groupID + "/items/" + key);
            else if (library.userID) out.unshift("http://zotero.org/users/" + library.userID + "/items/" + key);
        }
    }
    const keys = out.filter(isCanonical).map(function (u) {
        return u.slice(u.lastIndexOf("/") + 1);
    });
    return out.filter(function (u) {
        const web = /^https?:\/\/(?:www\.)?zotero\.org\/[^/]+\/items\/([A-Z0-9]+)$/i.exec(u);
        return !(web && !isCanonical(u) && keys.indexOf(web[1]) !== -1);
    });
}

/**
 * prefsXML is the document preferences Zotero keeps: the style's id,
 * whether it has a bibliography, and that citations are fields.
 * @param {string} styleID - the style's full id (http://www.zotero.org/styles/...)
 * @param {boolean} hasBibliography
 * @param {string} session - Zotero's session id for the document
 * @returns {string}
 */
function prefsXML(styleID, hasBibliography, session) {
    return (
        '<data data-version="3" zotero-version="7.0.0">' +
        '<session id="' + escapeXml(session) + '"/>' +
        '<style id="' + escapeXml(styleID) + '" hasBibliography="' + (hasBibliography ? "1" : "0") +
        '" bibliographyStyleHasBeenSet="1"/>' +
        '<prefs><pref name="fieldType" value="Field"/></prefs></data>'
    );
}

/**
 * prefsChunks cuts the preferences into the properties' values.
 * @param {string} xml
 * @returns {Array<string>}
 */
function prefsChunks(xml) {
    const out = [];
    for (let i = 0; i < xml.length; i += PREF_CHUNK) out.push(xml.slice(i, i + PREF_CHUNK));
    return out;
}

/**
 * readPrefs reads the joined ZOTERO_PREF text: the style id and the
 * session, or null when there is no style in it.
 * @param {string} xml
 * @returns {{styleID: string, session: string} | null}
 */
function readPrefs(xml) {
    if (!xml) return null;
    const style = /<style\b[^>]*\bid="([^"]+)"/.exec(xml);
    if (!style) return null;
    const session = /<session\b[^>]*\bid="([^"]+)"/.exec(xml);
    return { styleID: unescapeXml(style[1]), session: session ? unescapeXml(session[1]) : "" };
}

/**
 * styleShortName is a style id's last part (".../styles/apa" is "apa").
 * @param {string} id
 * @returns {string}
 */
function styleShortName(id) {
    return String(id || "").replace(/^https?:\/\/www\.zotero\.org\/styles\//, "");
}

/**
 * styleFullId is the id Zotero names a repository style by.
 * @param {string} name - the short name
 * @returns {string}
 */
function styleFullId(name) {
    return /^https?:\/\//.test(name) ? name : STYLE_BASE + name;
}

/**
 * resolveStyleName finds a bundled style by a document's style id, also by
 * an old id the CSL repository renamed (documents from before 2024 name
 * Vancouver http://www.zotero.org/styles/vancouver). null when the style
 * is not bundled.
 * @param {string} id
 * @param {Array<string>} names - the bundled styles' short names
 * @param {Object<string, string>} renamed - renamed-styles.json: old short name to new
 * @returns {string | null}
 */
function resolveStyleName(id, names, renamed) {
    const short = styleShortName(id);
    if (names.indexOf(short) !== -1) return short;
    const to = renamed && Object.prototype.hasOwnProperty.call(renamed, short) ? renamed[short] : "";
    return to && names.indexOf(to) !== -1 ? to : null;
}

/**
 * randomID is an id as Zotero makes them: eight letters and digits.
 * @returns {string}
 */
function randomID() {
    const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += a[bytes[i] % a.length];
    return s;
}

/** @param {string} s */
function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** @param {string} s */
function unescapeXml(s) {
    return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export {
    SCHEMA,
    fieldKind,
    citationValue,
    bibliographyValue,
    canonicalUri,
    canonicalUris,
    prefsXML,
    prefsChunks,
    readPrefs,
    styleShortName,
    styleFullId,
    resolveStyleName,
    randomID,
};
