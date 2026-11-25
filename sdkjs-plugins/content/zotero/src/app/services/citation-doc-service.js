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

/// <reference path="../../../../../v1/onlyoffice-types/index.d.ts" /> 
/// <reference path="../types-global.js" />
/// <reference path="../csl/citation/types.js" />
/// <reference path="../csl/styles/types.js" />

// Hearth: a field's result is written as formatted paragraphs (Hearth
// Office's AddinFieldData.Paragraphs: runs with their emphasis, a hanging
// indent per paragraph), by the editor inside the field in one step.
// Upstream wrote plain Content and then styled ranges of it with separate
// commands, and on editors from 9.4 pasted the bibliography as HTML,
// which in this engine broke the field's end mark.

import { fieldKind } from "../hearth/zotero-format";

/**
 * @typedef {import("../hearth/runs").Para} Para
 * @typedef {AddinFieldData & {Paragraphs?: Array<Para>}} ResultField
 */

class CitationDocService {
    /**
     * @param {Array<Para>} paragraphs
     * @param {string} value
     * @returns {Promise<string>} the new field's id
     */
    async addBibliography(paragraphs, value) {
        /** @type {ResultField} */
        const field = {
            FieldId: "",
            Value: value,
            Content: " ",
            Paragraphs: paragraphs,
        };
        await this.#addAddinField(field);
        const added = await this.getCurrentField();
        return added ? added.FieldId : "";
    }

    /**
     * @param {Array<Para>} paragraphs
     * @param {string} value
     * @param {NoteStyle | null} notesStyle
     * @returns {Promise<boolean>}
     */
    async addCitation(paragraphs, value, notesStyle) {
        /** @type {ResultField} */
        const field = {
            FieldId: "",
            Value: value,
            Content: " ",
            Paragraphs: paragraphs,
        };
        const bHasNotes = !!(notesStyle && ["footnotes", "endnotes"].indexOf(notesStyle) !== -1)
        if (bHasNotes) {
            await this.#addNote(notesStyle);
        }

        await this.#addAddinField(field);

        if (bHasNotes) {
            await this.#selectFieldReference();
        }
        return bHasNotes;
    }

    /** @returns {Promise<AddinFieldData | null>} */
    getCurrentField() {
        return new Promise(function (resolve, reject) {
            window.Asc.plugin.executeMethod("GetCurrentAddinField", undefined, resolve);
        });
    }

    /** @returns {Promise<Array<AddinFieldData>>} */
    getAddinZoteroFields() {
        return this.#getAllAddinFields().then(function (arrFields) {
            return (arrFields || []).filter(function (field) {
                return fieldKind(field.Value) !== "";
            });
        });
    }

    /** @returns {Promise<boolean>} */
    saveAsText() {
        return this.getAddinZoteroFields().then(function (arrFields) {
            let count = arrFields.length;
            if (!count) {
                window.Asc.plugin.executeCommand("close", "");
                return false;
            }
            const promises = arrFields.map(function (field) {
                return new Promise(function (resolve) {
                    window.Asc.plugin.executeMethod(
                        "RemoveFieldWrapper",
                        [field.FieldId],
                        resolve,
                    );
                });
            });
            return Promise.all(promises).then(() => {
                return true;
            }).catch(e => {
                console.error(e);
                return false;
            });
        });
    }

    /**
     * @param {Array<ResultField>} fields
     * @returns {Promise<string[]>}
     */
    async updateAddinFields(fields) {
        const fieldIds = fields.map(field => field.FieldId);
        await new Promise((resolve) => {
            window.Asc.plugin.executeMethod(
                "UpdateAddinFields",
                [fields],
                resolve,
            );
        });
        return fieldIds;
    }

    /**
     * @param {Array<ResultField>} fields
     * @returns {Promise<void>}
     */
    async convertNotesToText(fields) {
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (!field.FieldId) {
                console.error("Field id is not defined");
                continue;
            }

            const selectFieldResult = await this.#selectField(field.FieldId);
            if (!selectFieldResult) continue;
            const isReferenceSelected = await this.#selectFieldReference();
            if (!isReferenceSelected) continue;
            await this.#removeSuperscript();
            await this.#removeSelectedContent();
            await this.#addAddinField(field);
        }
    }

    /**
     * @param {Array<ResultField>} fields
     * @param {"footnotes" | "endnotes"} notesStyle
     * @returns {Promise<void>}
     */
    async convertTextToNotes(fields, notesStyle) {
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (!field.FieldId) continue;

            const selectFieldResult = await this.#selectField(field.FieldId);
            if (!selectFieldResult) continue;
            await this.#removeSelectedContent();
            await this.#addNote(notesStyle);
            await this.#addAddinField(field);
        }
    }

    /**
     * @param {Array<ResultField>} fields
     * @param {"footnotes" | "endnotes"} notesStyle
     * @returns {Promise<void>}
     */
    async convertNotesStyle(fields, notesStyle) {
        /** @type {Array<ResultField>} */
        const editedFields = [];

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (!field.FieldId) continue;

            if (!field.Paragraphs) {
                // save user changes
                editedFields.push(field);
                continue;
            }

            const selectFieldResult = await this.#selectField(field.FieldId);
            if (!selectFieldResult) continue;
            const isReferenceSelected = await this.#selectFieldReference();
            if (!isReferenceSelected) continue;
            await this.#removeSuperscript();
            await this.#removeSelectedContent();
            await this.#addNote(notesStyle);
            await this.#addAddinField(field);
        }
        if (editedFields.length) {
            await this.updateAddinFields(editedFields);
        }
    }

    /**
     * Hearth: the joined ZOTERO_PREF_n document properties ("" when none).
     * @returns {Promise<string>}
     */
    readPrefs() {
        return new Promise(function (resolve) {
            Asc.plugin.callCommand(
                function () {
                    const props = Api.GetDocument().GetCustomProperties();
                    let out = "";
                    for (let n = 1; n < 100; n++) {
                        const v = props.Get("ZOTERO_PREF_" + n);
                        if (v === undefined || v === null || v === "") break;
                        out += v;
                    }
                    return out;
                },
                false,
                false,
                function (/** @type {any} */ text) {
                    resolve(typeof text === "string" ? text : "");
                },
            );
        });
    }

    /**
     * Hearth: stores the preferences in ZOTERO_PREF_1, _2, ... as Zotero
     * does. Pieces left from a longer earlier text are emptied (the API
     * cannot remove a property), so the joined text ends where it should.
     * @param {Array<string>} chunks
     * @returns {Promise<void>}
     */
    writePrefs(chunks) {
        Asc.scope.prefChunks = chunks;
        return new Promise(function (resolve) {
            Asc.plugin.callCommand(
                function () {
                    const props = Api.GetDocument().GetCustomProperties();
                    const chunks = Asc.scope.prefChunks;
                    for (let n = 0; n < chunks.length; n++) {
                        props.Add("ZOTERO_PREF_" + (n + 1), chunks[n]);
                    }
                    for (let n = chunks.length + 1; n < 100; n++) {
                        const v = props.Get("ZOTERO_PREF_" + n);
                        if (v === undefined || v === null || v === "") break;
                        props.Add("ZOTERO_PREF_" + n, "");
                    }
                },
                false,
                false,
                function () {
                    resolve();
                },
            );
        });
    }

    /**
     * @param {string} fieldId
     * @param {boolean} [isBegin]
     * @returns {Promise<void>}
    */
    async moveCursorToField(fieldId, isBegin) {
        return new Promise((resolve) => {
            isBegin = isBegin ?? true;
            window.Asc.plugin.executeMethod("MoveCursorToField", [fieldId, isBegin], resolve);
        });
    }

    /**
     * @param {string} fieldId
     * @param {boolean} [isBeforeField]
     * @returns {Promise<void>}
    */
    async moveCursorOutsideField(fieldId, isBeforeField) {
        return new Promise((resolve) => {
            isBeforeField = isBeforeField ?? false;
            window.Asc.plugin.executeMethod("MoveCursorOutsideField", [fieldId, isBeforeField], resolve);
        });
    }

    /**
     * @returns {Promise<void>}
    */
    async moveCursorRight() {
        return new Promise((resolve) => {
            const isCalc = true;
            const isClose = false;
            Asc.plugin.callCommand(
                () => {
                    const doc = Api.GetDocument();
                    doc.MoveCursorRight(1, false);
                },
                isClose,
                isCalc,
                resolve,
            );
        });
    }

    /**
     * @param {ResultField} field
     * @returns {Promise<void>}
     */
    #addAddinField(field) {
        return new Promise(function (resolve) {
            window.Asc.plugin.executeMethod("AddAddinField", [field], resolve);
        });
    }

    /**
     * @param {"footnotes" | "endnotes"} notesStyle
     * @returns {Promise<void>}
     */
    #addNote(notesStyle) {
        Asc.scope.notesStyle = notesStyle;
        return new Promise((resolve) => {
            Asc.plugin.callCommand(
                () => {
                    const oDocument = Api.GetDocument();
                    if ("footnotes" === Asc.scope.notesStyle) {
                        oDocument.AddFootnote();
                    } else if ("endnotes" === Asc.scope.notesStyle) {
                        oDocument.AddEndnote();
                    }
                },
                false,
                false,
                resolve,
            );
        });
    }

    /**
     * @returns {Promise<Array<AddinFieldData>>}
     */
    #getAllAddinFields() {
        return new Promise(function (resolve, reject) {
            window.Asc.plugin.executeMethod("GetAllAddinFields", undefined, resolve);
        });
    }

    /** @returns {Promise<void>} */
    #removeSelectedContent() {
        return new Promise((resolve) => {
            window.Asc.plugin.executeMethod(
                "RemoveSelectedContent",
                undefined,
                resolve,
            );
        });
    }
    /**
     * @param {string} fieldId
     * @returns {Promise<boolean>}
     */
    #selectField(fieldId) {
        return new Promise(function (resolve) {
            window.Asc.plugin.executeMethod("SelectAddinField", [fieldId], () =>
                resolve(true),
            );
        });
    }

    /**
     * @returns {Promise<boolean>}
     */
    #selectFieldReference() {
        return new Promise(function (resolve) {
            const isCalc = true;
            const isClose = false;
            Asc.plugin.callCommand(
                () => {
                    const doc = Api.GetDocument();
                    const note = doc.GetCurrentFootEndnote();
                    if (!note) return;
                    const reference = note.SelectNoteReference();
                    if (!reference) return;
                },
                isClose,
                isCalc,
                () => resolve(true),
            );
        });
    }

    #removeSuperscript() {
        return new Promise(function (resolve) {
            const isCalc = false;
            const isClose = false;
            Asc.plugin.callCommand(
                () => {
                    const doc = Api.GetDocument();
                    const selRange = doc.GetRangeBySelect();
                    if (!selRange) return;
                    selRange.SetVertAlign("baseline");
                },
                isClose,
                isCalc,
                resolve,
            );
        });
    }

}

export { CitationDocService };
