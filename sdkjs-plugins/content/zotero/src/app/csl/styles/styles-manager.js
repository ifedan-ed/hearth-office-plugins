/*
 * (c) Copyright Ascensio System SIA 2010-2025
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

// @ts-check

/// <reference path="./types.js" />

import { CslStylesStorage } from "./storage";
import { CslStylesParser } from "./style-parser";
import {
    resolveStyleName,
    styleFullId,
} from "../../hearth/zotero-format";

// Hearth: styles come only from the plugin's own folder, the same set
// Hearth bundles (resources/csl/styles: index.json lists them,
// renamed.json is the CSL repository's renamed-styles.json). Upstream
// fetched styles.json and the styles from www.zotero.org when it could.

/**
 * One bundled style, as resources/csl/styles/index.json lists it.
 * @typedef {Object} BundledStyle
 * @property {string} id - the style's full id
 * @property {string} file - its file in resources/csl/styles
 * @property {string} title
 * @property {"numeric"|"author-date"|"note"} kind
 * @property {string} [parent] - a dependent style's parent's id
 */

/**
 * @param {string} lastStyleKey
 */
function CslStylesManager(lastStyleKey) {
    this._customStylesStorage = new CslStylesStorage();

    this._STYLES_LOCAL = "./resources/csl/styles/";

    this._lastStyleKey = lastStyleKey;
    this._lastNotesStyleKey = "zoteroNotesStyleId";
    this._lastFormatKey = "zoteroFormatId";
    this._lastUsedStyleContainBibliographyKey = "zoteroContainBibliography";

    // Hearth: the default for a document with no style yet is Hearth's
    // own (NLM/Vancouver, citation-sequence), so both tabs start alike.
    this._defaultStyle = "nlm-citation-sequence";

    /** @type {Promise<{styles: Array<BundledStyle>, renamed: Object<string, string>}> | null} */
    this._index = null;

    /** @type {Object.<string, string>} */
    this._cache = {};
}

/**
 * The bundled styles and the renamed ones, read once.
 * @returns {Promise<{styles: Array<BundledStyle>, renamed: Object<string, string>}>}
 */
CslStylesManager.prototype._loadIndex = function () {
    const self = this;
    if (!this._index) {
        this._index = Promise.all([
            this._fetchLocal("index.json").then(function (text) {
                return JSON.parse(text);
            }),
            this._fetchLocal("renamed.json").then(function (text) {
                return JSON.parse(text);
            }),
        ]).then(function (both) {
            return { styles: both[0], renamed: both[1] };
        });
        this._index.catch(function () {
            self._index = null;
        });
    }
    return this._index;
};

/**
 * @param {string} file - a file in resources/csl/styles
 * @returns {Promise<string>}
 */
CslStylesManager.prototype._fetchLocal = function (file) {
    return fetch(this._STYLES_LOCAL + file).then(function (resp) {
        if (!resp.ok) throw "A citation style file is missing: " + file;
        return resp.text();
    });
};

/**
 * A bundled style's short name (its file's name).
 * @param {BundledStyle} style
 * @returns {string}
 */
function bundledName(style) {
    return style.file.replace(/\.csl$/, "");
}

/**
 * @param {File} file - The file to be added.
 * @returns {Promise<StyleInfo>} - A promise that resolves when the file is added.
 * @throws {Error} - If the file is not a .csl or .xml file, or if the file size is greater than 1 MB.
 */
CslStylesManager.prototype.addCustomStyle = function (file) {
    var self = this;

    return new Promise(function (resolve, reject) {
        let fileName = file.name.toLowerCase();
        if (fileName.slice(-4) === ".csl" || fileName.slice(-4) === ".xml") {
            fileName = fileName.substring(0, fileName.length - 4).trim();
        } else {
            reject("Please select a .csl or .xml file.");
        }

        if (file.size > 1024 * 1024) {
            reject("Maximum file size is 1 MB.");
        }
        resolve(fileName);
    }).then(function (fileName) {
        return self._readCSLFile(file).then(function (content) {
            return self._customStylesStorage.setStyle(fileName, content);
        });
    });
};

/**
 * @returns {StyleFormat}
 */
CslStylesManager.prototype.getLastUsedFormat = function () {
    let lastUsedFormat = localStorage.getItem(this._lastFormatKey);
    switch (lastUsedFormat) {
        case "note":
        case "numeric":
        case "author":
        case "author-date":
        case "label":
            return lastUsedFormat;
    }
    return "numeric";
};

/**
 * @returns {NoteStyle}
 */
CslStylesManager.prototype.getLastUsedNotesStyle = function () {
    let lastUsedNotesStyle = localStorage.getItem(this._lastNotesStyleKey);
    if (
        lastUsedNotesStyle === "footnotes" ||
        lastUsedNotesStyle === "endnotes"
    ) {
        return lastUsedNotesStyle;
    }
    return "footnotes";
};

/**
 * @returns {string|null} - style id
 */
CslStylesManager.prototype.getLastUsedStyleId = function () {
    let lastUsedStyle = localStorage.getItem(this._lastStyleKey);
    if (lastUsedStyle) {
        return lastUsedStyle;
    }
    return null;
};

/**
 * @returns {string} - style id
 */
CslStylesManager.prototype.getLastUsedStyleIdOrDefault = function () {
    return this.getLastUsedStyleId() || this._defaultStyle;
};

/**
 * @returns {string} - the style a document with none starts with
 */
CslStylesManager.prototype.getDefaultStyle = function () {
    return this._defaultStyle;
};

/**
 * Hearth: the full id Zotero names a style by in the document's
 * preferences: a bundled style's id, a custom style's own <id>.
 * @param {string} styleName
 * @returns {Promise<string>}
 */
CslStylesManager.prototype.getStyleFullId = function (styleName) {
    const custom = this._customStylesStorage.getStyle(styleName);
    if (custom) {
        const id = /<id>\s*([^<\s]+)\s*<\/id>/.exec(custom);
        return Promise.resolve(id ? id[1] : styleFullId(styleName));
    }
    return this._loadIndex().then(function (index) {
        const found = index.styles.find(function (s) {
            return bundledName(s) === styleName;
        });
        return found ? found.id : styleFullId(styleName);
    });
};

/**
 * Hearth: the bundled style a document's preferences name (also by an old,
 * renamed id), or null when it is not bundled.
 * @param {string} styleID
 * @returns {Promise<string|null>}
 */
CslStylesManager.prototype.resolveDocumentStyle = function (styleID) {
    const customNames = this._customStylesStorage.getStyleNames();
    return this._loadIndex().then(function (index) {
        const names = index.styles.map(bundledName).concat(customNames);
        return resolveStyleName(styleID, names, index.renamed);
    });
};

/**
 * The style's CSL text: a custom one's, a bundled one's, or for a
 * journal's dependent style its parent's rules in the journal's locale
 * (as Hearth formats it).
 * @param {string} styleName
 * @param {boolean} saveToLocalStorage
 * @returns {Promise<{content: string|null, styleFormat: StyleFormat}>} - csl file content
 */
CslStylesManager.prototype.getStyle = function (
    styleName,
    saveToLocalStorage = true
) {
    const self = this;

    return Promise.resolve(styleName)
        .then(function (styleName) {
            if (self._cache[styleName]) {
                return self._cache[styleName];
            }
            const custom = self._customStylesStorage.getStyle(styleName);
            if (custom) {
                return custom;
            }
            return self._loadBundled(styleName);
        })
        .then(function (content) {
            const styleFormat =
                (content && CslStylesParser.getCitationFormat(content)) ||
                "numeric";
            const result = {
                content: content,
                styleFormat: styleFormat,
            };
            if (content) {
                self._cache[styleName] = content;
            }
            if (content && saveToLocalStorage) {
                self._saveLastUsedStyle(styleName, content, styleFormat);
            }

            return result;
        });
};

/**
 * @param {string} styleName
 * @returns {Promise<string>}
 */
CslStylesManager.prototype._loadBundled = function (styleName) {
    const self = this;
    return this._loadIndex().then(function (index) {
        /** @param {string} name */
        const byName = function (name) {
            return index.styles.find(function (s) {
                return bundledName(s) === name;
            });
        };
        const name = resolveStyleName(
            styleName,
            index.styles.map(bundledName),
            index.renamed
        );
        const info = name ? byName(name) : null;
        if (!info) {
            throw "The style is not available in the local version of the plugin.";
        }
        return self._fetchLocal(info.file).then(function (xml) {
            if (!info.parent) return xml;
            const parent = index.styles.find(function (s) {
                return s.id === info.parent;
            });
            if (!parent) {
                throw "The style is not available in the local version of the plugin.";
            }
            const lang = /default-locale="([^"]+)"/.exec(xml);
            return self._fetchLocal(parent.file).then(function (parentXml) {
                if (!lang) return parentXml;
                return parentXml
                    .replace(/<style\b/, '<style default-locale="' + lang[1] + '"')
                    .replace(
                        /(<style\b[^>]*?) default-locale="[^"]*"([^>]*default-locale=)/,
                        "$1$2"
                    );
            });
        });
    });
};

/**
 * @returns {Promise<Array<StyleInfo>>}
 */
CslStylesManager.prototype.getStylesInfo = function () {
    const self = this;
    return this._loadIndex().then(function (index) {
        /** @type {Array<StyleInfo>} */
        var resultStyles = self._customStylesStorage.getStylesInfo();
        var customNames = self._customStylesStorage.getStyleNames();

        index.styles.forEach(function (style) {
            const name = bundledName(style);
            if (customNames.indexOf(name) !== -1) {
                // already added
                return;
            }
            resultStyles.push({
                categories: { fields: [], format: style.kind },
                dependent: style.parent ? 1 : 0,
                parent: style.parent,
                href: style.id,
                name: name,
                title: style.title,
                updated: "",
            });
        });
        resultStyles.sort((a, b) => a.title.localeCompare(b.title));

        return resultStyles;
    });
};

/**
 * @param {string} id
 * @returns {string | null}
 */
CslStylesManager.prototype.cached = function (id) {
    if (Object.hasOwnProperty.call(this._cache, id)) {
        return this._cache[id];
    }
    return null;
};

/**
 * @returns {boolean}
 */
CslStylesManager.prototype.isLastUsedStyleContainBibliography = function () {
    let containBibliography = localStorage.getItem(
        this._lastUsedStyleContainBibliographyKey
    );
    return containBibliography !== "false";
};

/**
 * @param {string} content
 * @returns {boolean}
 */
CslStylesManager.prototype._isValidCSL = function (content) {
    return (
        content.indexOf("<?xml") > -1 &&
        content.indexOf("<style") > -1 &&
        content.indexOf("<macro") > -1 &&
        content.indexOf("citation") > -1
    );
};

/**
 * Reads a file and returns its content as a string.
 * Rejects the promise if the file is not a valid CSL file.
 * @param {File} file - The file to be read.
 * @returns {Promise<string>} - A promise that resolves with the file content if the file is a valid CSL file.
 * @throws {Error} - If the file is not a valid CSL file.
 */
CslStylesManager.prototype._readCSLFile = function (file) {
    const self = this;
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();

        reader.onload = function (e) {
            var fileContent = e.target ? String(e.target.result) : "";

            if (!self._isValidCSL(fileContent)) {
                reject("The file is not a valid CSL file");
                return;
            }

            resolve(fileContent);
        };

        reader.onerror = function () {
            reject("Failed to read file");
        };

        reader.readAsText(file);
    });
};

/**
 * @param {string} content
 * @param {string} id
 * @param {StyleFormat} currentStyleFormat
 */
CslStylesManager.prototype._saveLastUsedStyle = function (
    id,
    content,
    currentStyleFormat
) {
    this._cache[id] = content;
    localStorage.setItem(this._lastStyleKey, id);
    localStorage.setItem(this._lastFormatKey, currentStyleFormat);
    const containBibliography =
        CslStylesParser.isStyleContainBibliography(content);
    localStorage.setItem(
        this._lastUsedStyleContainBibliographyKey,
        containBibliography.toString()
    );
};

/**
 * @param {NoteStyle} notesStyle
 */
CslStylesManager.prototype.saveLastUsedNotesStyle = function (notesStyle) {
    localStorage.setItem(this._lastNotesStyleKey, notesStyle);
};

export { CslStylesManager };
