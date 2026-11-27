# Spelling and grammar

Spelling, grammar and style checking in Hearth Office's editors, by the
LanguageTool server Hearth runs itself. A Spelling and grammar button in
the Review tab opens a side panel: the language (or detect it), Check,
and each finding with the words around it, its message and the
replacements offered. A replacement's button puts it in at its place;
Ignore drops the finding.

- Text documents are checked whole, paragraph by paragraph, in a few
  requests; spreadsheets and presentations check the selected text, and
  the fixes chosen replace the selection.
- The text goes from the editor to Hearth's page, to Hearth's API and to
  Hearth's own LanguageTool, on a network with no way out. The editor
  never reaches LanguageTool, and nothing is kept.

Tests: `node --test .tests/chunks.test.mjs`.
