# Hearth Assistant

The AI add-in of Hearth Office. It adds an Assistant tab to the document,
spreadsheet and presentation editors and a side panel that shows each answer
as it is written.

- Draft: writes new text from an instruction, fitted to the text around the
  cursor (documents, presentations).
- Rewrite: rewrites the selected text; in a document the result goes in as a
  tracked change that can be accepted or rejected.
- Summarise: the selection, or the whole document, sheet or deck.
- Explain formula: says what the formula in the active cell works out and
  how, using the cells it refers to and their headings; the explanation can
  be kept as a comment on the cell (spreadsheets).
- Notes to slides: turns pasted notes into slides on the deck's own layout,
  with speaker notes (presentations).
- Ask: a question about the open document.

## How it reaches a model

Every request goes to the Document Server's own proxy (`/ai-proxy`), which
checks the editing session, adds the key on the server and forwards the
request to the provider named in the server's settings (`aiSettings`). The
browser holds no key and calls no provider. The model is the one set as
`aiSettings.actions.Chat.model`; there is no settings screen in the add-in
and no second choice. Without that setting the add-in says it is not set up.

The provider must speak the OpenAI chat-completions protocol with streaming
(LiteLLM does).

## Installing

Put this folder and the plugin SDK (`sdkjs-plugins/v1`) into the server's
`sdkjs-plugins` folder and start it with the document:

    "services": {"CoAuthoring": {"plugins": {
      "autostart": ["asc.{3F6A1C9E-52B7-4D0A-8E4B-7A1D9C0F2B61}"]}}}

The Hearth Office image has it built in.

## Files

| File | What it holds |
| --- | --- |
| scripts/main.js | The toolbar tab, the panel, and the path of one request |
| scripts/tasks.js | The tasks as data: where each is offered and how its request is worded |
| scripts/context.js | Reading the document: selection, outline, text at the cursor, cells, slides |
| scripts/model.js | The one model call, through the server's proxy, streamed |
| scripts/apply.js | Putting an answer into the document |
| scripts/markup.js | The small Markdown subset answers use, as HTML or plain text |
| panel.html, scripts/panel.js, panel.css | The side panel |
| translations/langs.json | An empty list of translations: the add-in is in English only. The plugin SDK asks every page for this list when the editor's language is not en-EN; with the list there it stops after one answer instead of two 404s (langs.json, then the language's own file) |

No build step: plain scripts, no dependencies.
