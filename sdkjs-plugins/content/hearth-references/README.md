# References

Hearth's citation add-in for Hearth Office's document editor: a
References tab that cites from the person's Hearth library and PubMed,
keeps the bibliography in the document's citation style, and stores every
citation in Zotero's own Word field format, so a paper stays live for a
co-author who uses Zotero in Word or LibreOffice, and the reverse.

- Insert citation: search the library and PubMed in one box (results
  marked by where they come from, a paper in both shown once), pick one
  or more, give each a page, prefix or suffix, Insert.
- Edit citation, Bibliography, Refresh, Style (the whole document's),
  Citations (the document's citation marks; a click selects one; Unlink
  turns them into plain text).
- Fields: `ADDIN ZOTERO_ITEM CSL_CITATION {json}` per citation,
  `ADDIN ZOTERO_BIBL {...} CSL_BIBLIOGRAPHY` for the bibliography, the
  style in the document properties `ZOTERO_PREF_n` (scripts/fields.js).
- Formatting is the host's: the add-in posts its requests to Hearth's own
  page (the top window, which opened the editor), which formats with
  citeproc-js and the bundled CSL styles and searches with the person's
  own session (scripts/bridge.js). Hearth hands its origin in the plugin
  options (`hearthOrigin`); without it the tab does not show.
- Field results are written as formatted paragraphs through
  AddinFieldData.Paragraphs, a Hearth Office extension of the plugin API.

Tests (not shipped: dot-folders stay out of the image): `node --test .tests/fields.test.mjs`.
