// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// citeproc-js's HTML turned into paragraphs of formatted runs: what the
// editor writes into a field's result (Hearth Office's
// AddinFieldData.Paragraphs). The same reading as Hearth's own
// (web/src/lib/cite/runs.ts), so a citation looks the same whichever tab
// wrote it. citeproc's HTML is small and known: <i>, <b>, <sup>, <sub>,
// spans for small capitals, upright text, underline and no decoration, the
// bibliography's csl-entry divs with csl-left-margin and csl-right-inline,
// and a few entities. A small tokenizer reads it; no HTML is parsed into
// the page.
//
// A run states all of its emphasis: what it leaves out is off when the
// editor writes it, so a style change from superscript numbers to author
// and year leaves no superscript behind.

// @ts-check

/**
 * @typedef {Object} Run
 * @property {string} Text
 * @property {boolean} [Bold]
 * @property {boolean} [Italic]
 * @property {boolean} [SmallCaps]
 * @property {boolean} [Underline]
 * @property {"superscript"|"subscript"} [VertAlign]
 */

/**
 * @typedef {Object} Para
 * @property {Array<Run>} Runs
 * @property {number} [IndLeft] - twips
 * @property {number} [IndFirstLine] - twips
 */

/**
 * Bibliography layout, from citeproc's bibliography parameters.
 * @typedef {Object} Layout
 * @property {boolean} [hanging] - hangingindent
 * @property {boolean} [secondFieldAlign] - second-field-align
 * @property {number} [maxOffset] - maxoffset (characters)
 */

/** @type {Object<string, string>} */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * decode turns HTML entities into characters.
 * @param {string} s
 * @returns {string}
 */
function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
        if (e[0] === "#") {
            const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        const name = e.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : m;
    });
}

/**
 * htmlParagraphs reads citeproc's HTML: each csl-entry div is a paragraph
 * (a citation, which has none, is one paragraph). With a hanging indent
 * the paragraphs hang by half an inch; with second-field-align (numbered
 * bibliographies) the number is followed by a space and the paragraph
 * hangs by the widest number (maxOffset characters, 120 twips each, as
 * Zotero's Word plugin sets it).
 * @param {string} html
 * @param {Layout} [layout]
 * @returns {{plain: string, paragraphs: Array<Para>}}
 */
function htmlParagraphs(html, layout) {
    layout = layout || {};
    /** @type {Array<Para>} */
    const paragraphs = [];
    /** @type {Para | null} */
    let cur = null;
    /** @type {Array<{tag: string, style: Style}>} */
    const stack = [];
    /** @typedef {{b: boolean, i: boolean, sc: boolean, u: boolean, va: ""|"superscript"|"subscript"}} Style */
    /** @type {Style} */
    let style = { b: false, i: false, sc: false, u: false, va: "" };
    let entryDepth = -1;

    const start = function () {
        /** @type {Para} */
        const p = { Runs: [] };
        if (layout && layout.secondFieldAlign && layout.maxOffset) {
            p.IndLeft = Math.round(layout.maxOffset * 120);
            p.IndFirstLine = -p.IndLeft;
        } else if (layout && layout.hanging) {
            p.IndLeft = 720;
            p.IndFirstLine = -720;
        }
        paragraphs.push(p);
        cur = p;
        return p;
    };
    const add = function (/** @type {string} */ text) {
        if (!text) return;
        const p = cur || start();
        /** @type {Run} */
        const r = { Text: text };
        if (style.b) r.Bold = true;
        if (style.i) r.Italic = true;
        if (style.sc) r.SmallCaps = true;
        if (style.u) r.Underline = true;
        if (style.va) r.VertAlign = style.va;
        const last = p.Runs[p.Runs.length - 1];
        if (last && sameLook(last, r)) last.Text += text;
        else p.Runs.push(r);
    };

    const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(html))) {
        if (m[4] !== undefined) {
            // Whitespace between bibliography divs is layout, not text.
            const t = decode(m[4]);
            if (cur || t.trim()) add(t.replace(/\s*\n\s*/g, cur ? " " : ""));
            continue;
        }
        const close = m[1] === "/";
        const tag = m[2].toLowerCase();
        const attrs = m[3];
        if (tag === "br") {
            add(" ");
            continue;
        }
        if (close) {
            const top = stack.pop();
            if (top) style = top.style;
            if (tag === "div" && stack.length === entryDepth) {
                cur = null;
                entryDepth = -1;
            } else if (tag === "div" && top && /csl-left-margin/.test(top.tag)) {
                add(" ");
            }
            continue;
        }
        stack.push({ tag: tag + attrs, style: style });
        style = { b: style.b, i: style.i, sc: style.sc, u: style.u, va: style.va };
        if (tag === "div" && /csl-entry/.test(attrs)) {
            entryDepth = stack.length - 1;
            start();
        }
        if (tag === "i" || tag === "em") style.i = true;
        if (tag === "b" || tag === "strong") style.b = true;
        if (tag === "sup") style.va = "superscript";
        if (tag === "sub") style.va = "subscript";
        if (tag === "span") {
            const found = /style="([^"]*)"/.exec(attrs);
            const css = (found ? found[1] : "").replace(/\s/g, "").toLowerCase();
            if (css.indexOf("font-variant:small-caps") !== -1) style.sc = true;
            if (css.indexOf("font-style:normal") !== -1) style.i = false;
            if (css.indexOf("font-weight:normal") !== -1) style.b = false;
            if (css.indexOf("text-decoration:underline") !== -1) style.u = true;
            if (css.indexOf("text-decoration:none") !== -1) style.u = false;
        }
    }

    // Trim each paragraph's ends.
    paragraphs.forEach(function (p) {
        if (!p.Runs.length) return;
        p.Runs[0].Text = p.Runs[0].Text.replace(/^\s+/, "");
        const last = p.Runs[p.Runs.length - 1];
        last.Text = last.Text.replace(/\s+$/, "");
        p.Runs = p.Runs.filter(function (r) {
            return r.Text;
        });
    });
    const kept = paragraphs.filter(function (p) {
        return p.Runs.length;
    });
    const plain = kept
        .map(function (p) {
            return p.Runs.map(function (r) {
                return r.Text;
            }).join("");
        })
        .join("\n");
    return { plain: plain, paragraphs: kept };
}

/**
 * @param {Run} a
 * @param {Run} b
 */
function sameLook(a, b) {
    return (
        !!a.Bold === !!b.Bold &&
        !!a.Italic === !!b.Italic &&
        !!a.SmallCaps === !!b.SmallCaps &&
        !!a.Underline === !!b.Underline &&
        a.VertAlign === b.VertAlign
    );
}

export { decode, htmlParagraphs };
