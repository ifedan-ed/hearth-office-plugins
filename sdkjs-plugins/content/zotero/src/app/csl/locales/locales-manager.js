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

// Hearth: locales come only from the plugin's own folder, the six Hearth
// bundles (resources/csl/locales). Upstream fetched them from
// raw.githubusercontent.com and fell back to its own copies.

function LocalesManager() {
    this._LOCALES_PATH = "./resources/csl/locales/";

    /** The bundled locales: the languages offered. */
    this.LOCALES = ["en-US", "en-GB", "fr-FR", "de-DE", "es-ES", "pt-PT"];

    this._lastLanguageKey = "zoteroLang";

    /** @type {string | null} */
    this._selectedLanguage = null;

    /** @type {Object<string, string>} */
    this._cache = {};
}

/**
 * Get locale data
 * @param {string} langTag
 * @returns {Promise<string>}
 */
LocalesManager.prototype.loadLocale = function (langTag) {
    this._selectedLanguage = langTag;
    return this._load(langTag);
};

/**
 * Hearth: loads every bundled locale (six small files), so a style's own
 * default-locale is at hand when citeproc asks for it, as in Hearth.
 * @returns {Promise<void>}
 */
LocalesManager.prototype.loadAll = function () {
    const self = this;
    return Promise.all(
        this.LOCALES.map(function (tag) {
            return self._load(tag);
        })
    ).then(function () {});
};

/**
 * @param {string} langTag
 * @returns {Promise<string>}
 */
LocalesManager.prototype._load = function (langTag) {
    const self = this;
    if (this._cache[langTag]) {
        return Promise.resolve(this._cache[langTag]);
    }
    return fetch(this._LOCALES_PATH + "locales-" + langTag + ".xml")
        .then(function (response) {
            if (!response.ok) throw "Failed to load language";
            return response.text();
        })
        .then(function (text) {
            self._cache[langTag] = text;
            return text;
        });
};

/**
 * @returns {string}
 */
LocalesManager.prototype.getLastUsedLanguage = function () {
    const saved = localStorage.getItem(this._lastLanguageKey);
    this._selectedLanguage =
        this._selectedLanguage ||
        (saved && this.LOCALES.indexOf(saved) !== -1 ? saved : null) ||
        "en-US";
    return this._selectedLanguage;
};

/**
 * @param {string} [localeId]
 * @returns {string|null}
 */
LocalesManager.prototype.getLocale = function (localeId) {
    if (localeId) {
        if (this._cache[localeId]) {
            return this._cache[localeId];
        }
        return null;
    }
    if (this._selectedLanguage && this._cache[this._selectedLanguage]) {
        return this._cache[this._selectedLanguage];
    }
    return null;
};

/**
 * @param {string} language
 */
LocalesManager.prototype.saveLastUsedLanguage = function (language) {
    this._selectedLanguage = language;
    localStorage.setItem(this._lastLanguageKey, language);
};

export { LocalesManager };
