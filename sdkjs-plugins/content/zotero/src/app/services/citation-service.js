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

/// <reference path="../zotero/types.js" />
/// <reference path="../../../vendor/citeproc/citeproc_commonjs.js" />

/**
 * @typedef {import('../csl/styles').CslStylesManager} CslStylesManager
 * @typedef {import('../zotero/zotero').ZoteroSdk} ZoteroSdk
 * @typedef {import('../csl/locales').LocalesManager} LocalesManager
 * @typedef {import('../csl/citation/citation-item').CitationItem} CitationItem
 */

import { CitationDocService } from "./citation-doc-service";
import { translate } from "./translate-service";
import { CSLCitation, CSLCitationStorage } from "../csl/citation";
import { AdditionalWindow } from "../pages/additional-window";
import {
    fieldKind,
    citationValue,
    bibliographyValue,
    prefsXML,
    prefsChunks,
    readPrefs,
    randomID,
} from "../hearth/zotero-format";
import { htmlParagraphs } from "../hearth/runs";

/** @typedef {import("../hearth/runs").Para} Para */
/** @typedef {AddinFieldData & {Paragraphs?: Array<Para>}} ResultField */

// Hearth: citations and the bibliography are written in Zotero's own
// format (hearth/zotero-format.js) with their results as formatted
// paragraphs (hearth/runs.js), formatted with citeproc-js 2.4.63 and the
// bundled styles as Hearth's References tab formats them: all citations
// at once, in document order (rebuildProcessorState), without forcing the
// language over a style's own.

class CitationService {
    /** @type {AdditionalWindow} */
    #additionalWindow;

    /**
     * @param {LocalesManager} localesManager
     * @param {CslStylesManager} cslStylesManager
     * @param {ZoteroSdk} sdk
     */
    constructor(localesManager, cslStylesManager, sdk) {
        this._bibPlaceholderIfEmpty =
            "Please insert some citation into the document.";
        this._sdk = sdk;
        this._localesManager = localesManager;
        this._cslStylesManager = cslStylesManager;
        this._storage = new CSLCitationStorage();
        /** @type {CSL.Engine} */
        this._formatter;
        this.citationDocService = new CitationDocService();
        this.#additionalWindow = new AdditionalWindow();
    }

    /**
     * @param {CSLCitation} cslCitation
     * @returns {Promise<boolean>}
     */
    #formatInsertLink(cslCitation) {
        const self = this;

        return Promise.resolve()
            .then(function () {
                // The new citation's items are in the storage; citeproc
                // learns of them here. (Upstream tested for items missing
                // from the storage after adding them to it, so it never
                // did.)
                /** @type {string[]} */
                var arrIds = [];
                self._storage.forEachItem(function (item, id) {
                    arrIds.push(id);
                });
                self._formatter.updateItems(arrIds);
            })
            .then(function () {
                const html =
                    self.#formatCitations().get(cslCitation.citationID) || "";
                const runs = htmlParagraphs(html);
                cslCitation.setFormattedCitation(html);
                cslCitation.setPlainCitation(runs.plain);
                let notesStyle = null;
                if ("note" === self._cslStylesManager.getLastUsedFormat()) {
                    notesStyle = self._cslStylesManager.getLastUsedNotesStyle();
                }
                return self.citationDocService.addCitation(
                    runs.paragraphs,
                    citationValue(cslCitation.toJSON()),
                    notesStyle,
                );
            });
    }

    /**
     * Hearth: every citation in the storage formatted together, in
     * document order, as Hearth's References tab formats them.
     * @returns {Map<string, string>} citationID to citeproc's HTML
     */
    #formatCitations() {
        const out = this._formatter.rebuildProcessorState(
            this._storage.getAllCitationsInJson(),
            "html",
        );
        /** @type {Map<string, string>} */
        const byID = new Map();
        out.forEach(function (/** @type {[string, number, string]} */ row) {
            byID.set(row[0], row[2]);
        });
        return byID;
    }

    /**
     * @param {Array<any>} items
     * @returns {Promise<Array<SearchResultItem>>}
     */
    #getSelectedInJsonFormat(items) {
        var arrUsrItems = [];
        /** @type {Object<string, string[]>} */
        var arrGroupsItems = {};
        for (var citationID in items) {
            var item = items[citationID];
            var userID = item["userID"];
            const groupID = item["groupID"];
            if (userID) {
                arrUsrItems.push(item.id);
            } else if (groupID) {
                if (!arrGroupsItems[groupID]) {
                    arrGroupsItems[groupID] = [];
                }
                arrGroupsItems[groupID].push(item.id);
            }
        }

        /** @type {Array<Promise<SearchResultItem[]>>} */
        var promises = [];
        if (arrUsrItems.length) {
            promises.push(
                this._sdk
                    .getItems(null, arrUsrItems, "json")
                    .then(function (res) {
                        return res.items || [];
                    }),
            );
        }

        for (var groupID in arrGroupsItems) {
            if (Object.hasOwnProperty.call(arrGroupsItems, groupID)) {
                promises.push(
                    this._sdk
                        .getGroupItems(
                            null,
                            groupID,
                            arrGroupsItems[groupID],
                            "json",
                        )
                        .then(function (res) {
                            return res.items || [];
                        }),
                );
            }
        }

        return Promise.all(promises).then(function (res) {
            return res.reduce((acc, resItems) => acc.concat(resItems), []);
        });
    }

    /**
     * The bibliography as formatted paragraphs: one per entry, italics and
     * the rest as runs, hanging or numbered as citeproc's parameters say.
     * Hearth: was HTML for PasteHtml (editors from 9.4) or text styled
     * afterwards; line and entry spacing are left to the document, as in
     * Hearth.
     * @returns {{paragraphs: Array<Para>, plain: string} | null}
     */
    #makeBibliography() {
        try {
            /** @type {false | [BibliographyStyles, Array<string>]} */
            const made = this._formatter.makeBibliography();
            if (!made) throw "no bibliography";
            const params = made[0];
            return htmlParagraphs(made[1].join(""), {
                hanging: !!params.hangingindent,
                secondFieldAlign: !!params["second-field-align"],
                maxOffset: params.maxoffset || 0,
            });
        } catch (e) {
            if (
                false ===
                this._cslStylesManager.isLastUsedStyleContainBibliography()
            ) {
                this.#additionalWindow.showInfoWindow("Warning!", "Style does not describe the bibliography");
            } else {
                console.error(e);
                throw "Failed to apply this style.";
            }
            return null;
        }
    }

    /**
     * @param {string} text
     * @returns {Array<Para>}
     */
    #textParagraphs(text) {
        return [{ Runs: [{ Text: text }] }];
    }

    /** @param {AddinFieldData} field */
    #extractField(field) {
        let citationObject;
        const citationStartIndex = field.Value.indexOf("{");
        const citationEndIndex = field.Value.lastIndexOf("}");
        if (citationStartIndex !== -1) {
            var citationString = field.Value.slice(
                citationStartIndex,
                citationEndIndex + 1,
            );
            citationObject = JSON.parse(citationString);
        }
        return citationObject;
    }
    /**
     * @param {Object & {citationID: string}} [updatedField]
     * @returns {Promise<{fieldsWithCitations: {field: ResultField, cslCitation: CSLCitation}[], bibField: ResultField | undefined}>}
     */
    #synchronizeStorageWithDocItems(updatedField) {
        const self = this;
        this._storage.clear();
        this._storage.setInNotes(
            this._cslStylesManager.getLastUsedFormat() === "note",
        );
        CSLCitation.resetUsedIDs();
        return this.citationDocService
            .getAddinZoteroFields()
            .then(function (/** @type {AddinFieldData[]} */ arrFields) {
                /** @type {AddinFieldData | undefined} */
                const bibField = arrFields.find(function (field) {
                    return fieldKind(field.Value) === "bibliography";
                });

                const fields = arrFields.filter(function (field) {
                    return fieldKind(field.Value) === "citation";
                });
                let fieldsWithCitations = fields.map(function (field) {
                    let citationObject = self.#extractField(field) || {};

                    let citationID = ""; // old format
                    if (!/^\s*(ADDIN\s+)?ZOTERO_CITATION\b/.test(field.Value)) {
                        citationID = citationObject.citationID;
                    }

                    let cslCitation = new CSLCitation(citationID);
                    // Hearth: the edited citation takes the edit window's
                    // items, every other keeps its own (upstream filled
                    // every citation with the edited one's items, which
                    // numbered and sorted the rest wrongly).
                    if (
                        updatedField &&
                        citationObject.citationID === updatedField.citationID
                    ) {
                        cslCitation.fillFromObject(updatedField);
                    } else {
                        cslCitation.fillFromObject(citationObject);
                    }
                    self._storage.addCslCitation(cslCitation);

                    return { field: { ...field }, cslCitation: cslCitation };
                });
                if (updatedField) {
                    fieldsWithCitations = fieldsWithCitations.filter(
                        function (b) {
                            if (
                                b.cslCitation.citationID ===
                                updatedField.citationID
                            ) {
                                return true;
                            }
                            return false;
                        },
                    );
                }

                return {
                    bibField: bibField,
                    fieldsWithCitations: fieldsWithCitations,
                };
            });
    }

    /**
     * @param {boolean} bNoHaveFields
     * @returns {Promise<string>}
     */
    #addBibliography(bNoHaveFields) {
        const bibliography = this.#makeBibliography();
        if (!this._cslStylesManager.isLastUsedStyleContainBibliography()) {
            throw "The current bibliographic style does not describe the bibliography";
        }
        const paragraphs = bNoHaveFields || !bibliography
            ? this.#textParagraphs(translate(this._bibPlaceholderIfEmpty))
            : bibliography.paragraphs;
        return this.citationDocService.addBibliography(
            paragraphs,
            bibliographyValue(""),
        );
    }

    /**
     * @param {boolean} bNoHaveFields
     * @param {ResultField} bibField
     * @returns {ResultField}
     */
    #updateBibliography(bNoHaveFields, bibField) {
        const bibliography = bNoHaveFields ? null : this.#makeBibliography();
        if (bibliography) {
            bibField.Content = bibliography.plain;
            bibField.Paragraphs = bibliography.paragraphs;
        } else {
            bibField.Content = translate(this._bibPlaceholderIfEmpty);
            bibField.Paragraphs = this.#textParagraphs(bibField.Content);
        }
        // Zotero's own Value; the JSON part already there is kept.
        bibField.Value = bibliographyValue(bibField.Value);

        return bibField;
    }

    /**
     * @param {{field: AddinFieldData, cslCitation: CSLCitation}[]} fieldsWithCitations
     * @param {boolean} bHardRefresh
     * @param {boolean} [bChangePosition]
     * @returns {Promise<AddinFieldData[]>}
     */
    async #getUpdatedFields(fieldsWithCitations, bHardRefresh, bChangePosition) {
        /** @type {ResultField[]} */
        const updatedFields = [];
        const formatted = this.#formatCitations();
        /** @param {string} s */
        const same = function (s) {
            return String(s || "").replace(/\u00A0/g, " ").trim();
        };

        for (let i = fieldsWithCitations.length - 1; i >= 0; i--) {
            let bHasChanges = !!bChangePosition;
            /** @type {{field: ResultField, cslCitation: CSLCitation}} */
            const { field, cslCitation } = fieldsWithCitations[i];

            const htmlCitation = formatted.get(cslCitation.citationID) || "";
            const runs = htmlParagraphs(htmlCitation);
            let oldContentInCit = cslCitation.getPlainCitation();
            const oldContentInDoc = field["Content"];
            if (oldContentInCit === "") {
                oldContentInCit = oldContentInDoc; // for old versions of plugin, where "PlainCitation" was not saved
            }
            const newContent = runs.plain;

            if (cslCitation.getDoNotUpdate()) {
                continue;
            }

            if (same(oldContentInCit) !== same(oldContentInDoc) && !bHardRefresh) {
                // content was changed by user, but not saved in citation object
                let text =
                    "<p>" +
                    translate(
                        "You have modified this citation since Zotero generated it. Do you want to keep your modifications and prevent future updates?",
                    ) +
                    "</p>" +
                    "<p>" +
                    translate(
                        "Clicking „Yes“ will prevent Zotero from updating this citation if you add additional citations, switch styles, or modify the item to which it refers. Clicking „No“ will erase your changes.",
                    ) +
                    "</p>" +
                    "<p>" +
                    translate("Original:") +
                    " " +
                    newContent +
                    "</p>" +
                    "<p>" +
                    translate("Modified:") +
                    " " +
                    oldContentInDoc +
                    "</p>";
                const bNeedSaveUserInput =
                    await this.#additionalWindow.show(
                        "Saving custom edits",
                        text,
                    );
                if (bNeedSaveUserInput) {
                    cslCitation.setDoNotUpdate();
                    // @ts-ignore
                    delete field["Content"];
                    delete field.Paragraphs;
                } else {
                    field["Content"] = newContent;
                    field.Paragraphs = runs.paragraphs;
                    cslCitation.setFormattedCitation(htmlCitation);
                    cslCitation.setPlainCitation(newContent);
                }
                bHasChanges = true;
            } else {
                if (newContent !== oldContentInDoc || oldContentInCit !== oldContentInDoc || oldContentInCit !== newContent) {
                    bHasChanges = true;
                }
                field["Content"] = newContent;
                field.Paragraphs = runs.paragraphs;
                cslCitation.setFormattedCitation(htmlCitation);
                cslCitation.setPlainCitation(newContent);
            }

            const newValue = citationValue(cslCitation.toJSON());
            if (field["Value"] !== newValue) {
                bHasChanges = true;
            }
            field["Value"] = newValue;

            if (bHasChanges) {
                updatedFields.push(field);
            }
        }

        return updatedFields;
    }

    #updateFormatter() {
        const self = this;

        /** @type {string[]} */
        const arrIds = [];
        this._storage.forEachItem(function (item, id) {
            arrIds.push(id);
        });
        // @ts-ignore
        this._formatter = new CSL.Engine(
            {
                /** @param {string} id */
                retrieveLocale: function (id) {
                    // As Hearth: a locale that is not bundled is en-US.
                    return (
                        self._localesManager.getLocale(id) ||
                        self._localesManager.getLocale("en-US")
                    );
                },
                /** @param {string} id */
                retrieveItem: function (id) {
                    const item = self._storage.getItem(id);
                    let index = self._storage.getItemIndex(id);
                    if (!item) return null;
                    return item.toFlatJSON(index);
                },
            },
            this._cslStylesManager.cached(
                this._cslStylesManager.getLastUsedStyleIdOrDefault(),
            ),
            this._localesManager.getLastUsedLanguage(),
            // Hearth: a style's own default-locale wins, as in Hearth
            // (upstream forced the chosen language over it).
            false,
        );
        if (arrIds.length) {
            this._formatter.updateItems(arrIds);
        }

        return;
    }

    /** @returns {Promise<AddinFieldData | null>} */
    async getCurrentField() {
        return this.citationDocService.getCurrentField();
    }

    /**
     * @returns {Promise<boolean>}
     */
    async saveAsText() {
        const isOk = await this.citationDocService.saveAsText();
        if (isOk) {
            this.#additionalWindow.showInfoWindow(
                "Success!",
                "All Zotero citations and the bibliography are now plain text.",
                "success",
            );
        }
        return isOk;
    }

    /**
     * @param {Array<SearchResultItem>} items
     * @returns {Promise<boolean>}
     */
    async insertSelectedCitations(items) {
        const self = this;

        try {
            await this.#synchronizeStorageWithDocItems();
            this.#updateFormatter();
        } catch (e) {
            throw e;
        }

        const cslCitation = new CSLCitation("");
        for (var citationID in items) {
            const item = items[citationID];

            cslCitation.fillFromObject(item);
        }

        return this.#getSelectedInJsonFormat(items).then((items) => {
            // adding information to existing information
            items.forEach(function (item) {
                cslCitation.fillFromObject(item);
            });
            this._storage.addCslCitation(cslCitation);
            return self.#formatInsertLink(cslCitation);
        }).then(async (hasNotes) => {
            // The first citation stores the document's style, as Zotero.
            await this.saveDocumentStyle(true);
            return hasNotes;
        });
    }

    /**
     * Hearth: the document's style as its Zotero preferences
     * (ZOTERO_PREF_n) name it, or null.
     * @returns {Promise<{styleID: string, session: string} | null>}
     */
    async readDocumentStyle() {
        return readPrefs(await this.citationDocService.readPrefs());
    }

    /**
     * Hearth: stores the chosen style in the document's Zotero preferences,
     * as Zotero does when the style is chosen or the first citation is
     * put in. The document's session id is kept.
     * @param {boolean} [onlyIfNone] - leave preferences already there
     * @returns {Promise<void>}
     */
    async saveDocumentStyle(onlyIfNone) {
        const text = await this.citationDocService.readPrefs();
        const old = readPrefs(text);
        if (old && onlyIfNone) return;
        const styleName = this._cslStylesManager.getLastUsedStyleIdOrDefault();
        const xml = prefsXML(
            await this._cslStylesManager.getStyleFullId(styleName),
            this._cslStylesManager.isLastUsedStyleContainBibliography(),
            (old && old.session) || randomID(),
        );
        if (xml === text) return;
        await this.citationDocService.writePrefs(prefsChunks(xml));
    }

    /** @returns {Promise<string>} */
    async insertBibliography() {
        try {
            const { fieldsWithCitations, bibField } =
                await this.#synchronizeStorageWithDocItems();
            const bNoHaveFields = fieldsWithCitations.length === 0;

            this.#updateFormatter();

            if (bibField) {
                const updatedFields = [
                    await this.#updateBibliography(bNoHaveFields, bibField),
                ];
                return this.citationDocService.updateAddinFields(updatedFields)
                    .then((fieldIds) => fieldIds ? fieldIds[0] : "");
            } else {
                return this.#addBibliography(bNoHaveFields);
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * @param {string} fieldId
     * @param {boolean} [isBegin]
     * @returns {Promise<void>}
     */
    async moveCursorToField(fieldId, isBegin) {
        return this.citationDocService.moveCursorToField(fieldId, isBegin);
    }

    /**
     * @param {string} fieldId
     * @param {boolean} [isBeforeField]
     * @returns {Promise<void>}
     */
    async moveCursorOutsideField(fieldId, isBeforeField) {
        return this.citationDocService.moveCursorOutsideField(fieldId, isBeforeField);
    }

    /**
     * @returns {Promise<void>}
     */
    async moveCursorRight() {
        return this.citationDocService.moveCursorRight();
    }

    /**
     * @param {boolean} [bHardRefresh]
     * @returns {Promise<void>}
     */
    async updateCslItems(bHardRefresh) {
        try {
            const { fieldsWithCitations, bibField } =
                await this.#synchronizeStorageWithDocItems();
            const bNoHaveFields = fieldsWithCitations.length === 0;

            this.#updateFormatter();

            /** @type {AddinFieldData[]} */
            let updatedFields = [];

            if (typeof bHardRefresh === "undefined") {
                const format = this._cslStylesManager.getLastUsedFormat();
                if (format === "numeric") {
                    bHardRefresh = true;
                }
            }
            if (typeof bHardRefresh === "boolean") {
                updatedFields = await this.#getUpdatedFields(
                    fieldsWithCitations,
                    bHardRefresh,
                );
            }

            if (bibField) {
                updatedFields.push(
                    await this.#updateBibliography(bNoHaveFields, bibField),
                );
            }

            if (updatedFields && updatedFields.length) {
                return this.citationDocService.updateAddinFields(updatedFields);
            }
        } catch (e) {
            throw e;
        }
    }
    /**
     * // it is a crutch, because "SelectAddinField" does not work with notes
     * @param {"footnotes" | "endnotes"} notesStyle
     * @returns {Promise<void>}
     */
    async updateCslItemsInNotes(notesStyle) {
        try {
            const { fieldsWithCitations, bibField } =
                await this.#synchronizeStorageWithDocItems();
            const bNoHaveFields = fieldsWithCitations.length === 0;

            this.#updateFormatter();

            /** @type {AddinFieldData[]} */
            let updatedFields = await this.#getUpdatedFields(
                fieldsWithCitations,
                false,
            );

            if (updatedFields && updatedFields.length) {
                await this.citationDocService.convertNotesStyle(
                    updatedFields,
                    notesStyle,
                );
            }

            if (bibField) {
                const bibFields = [
                    await this.#updateBibliography(bNoHaveFields, bibField),
                ];
                await this.citationDocService.updateAddinFields(bibFields);
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * @param {Object & {citationID: string}} updatedField
     * @param {"footnotes" | "endnotes"} [notesStyle]
     * @returns {Promise<void>}
     */
    async updateItem(updatedField, notesStyle) {
        try {
            const { fieldsWithCitations, bibField } =
                await this.#synchronizeStorageWithDocItems(updatedField);
            const bNoHaveFields = fieldsWithCitations.length === 0;

            this.#updateFormatter();

            /** @type {AddinFieldData[]} */
            let updatedFields = await this.#getUpdatedFields(
                fieldsWithCitations,
                true,
            );

            if (notesStyle && updatedFields && updatedFields.length) {
                await this.citationDocService.convertNotesStyle(
                    updatedFields,
                    notesStyle,
                );
                updatedFields = [];
            }

            /*if (bibField) {
                updatedFields.push(
                    await this.#updateBibliography(bNoHaveFields, bibField),
                );
            }*/

            if (updatedFields && updatedFields.length) {
                return this.citationDocService.updateAddinFields(updatedFields);
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * @param {"footnotes" | "endnotes"} [notesStyle]
     * @returns {Promise<void>}
     */
    async switchingBetweenNotesAndText(notesStyle) {
        try {
            const { fieldsWithCitations, bibField } =
                await this.#synchronizeStorageWithDocItems();
            const bNoHaveFields = fieldsWithCitations.length === 0;

            this.#updateFormatter();

            /** @type {AddinFieldData[]} */
            let updatedFields = await this.#getUpdatedFields(
                fieldsWithCitations,
                true,
            );

            if (updatedFields && updatedFields.length) {
                if (notesStyle) {
                    await this.citationDocService.convertTextToNotes(
                        updatedFields,
                        notesStyle,
                    );
                } else {
                    await this.citationDocService.convertNotesToText(
                        updatedFields,
                    );
                }
            }

            if (bibField) {
                const bibFields = [
                    await this.#updateBibliography(bNoHaveFields, bibField),
                ];
                await this.citationDocService.updateAddinFields(bibFields);
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * @param {"footnotes" | "endnotes"} notesStyle
     * @returns {Promise<void>}
     */
    async convertNotesStyle(notesStyle) {
        try {
            const { fieldsWithCitations } =
                await this.#synchronizeStorageWithDocItems();

            this.#updateFormatter();

            /** @type {AddinFieldData[]} */
            let updatedFields = await this.#getUpdatedFields(
                fieldsWithCitations,
                false,
                true,
            );

            if (!updatedFields || !updatedFields.length) return;

            await this.citationDocService.convertNotesStyle(
                updatedFields,
                notesStyle,
            );
        } catch (e) {
            throw e;
        }
    }

    /**
     * @param {AddinFieldData} field
     * @returns {Promise<Object & {citationID: string} | null>}
     */
    async showEditCitationWindow(field) {
        if (!field) return null;

        const citationObject = this.#extractField(field);
        const updatedField =
            await this.#additionalWindow.showEditWindow(citationObject);
        if (!updatedField) {
            // Cancel click
            return null;
        }
        return updatedField;
    }

    /** @param {string} message */
    async showWarningMessage(message) {
        this.#additionalWindow.showInfoWindow("Warning!", message);
    }
}

export { CitationService };
