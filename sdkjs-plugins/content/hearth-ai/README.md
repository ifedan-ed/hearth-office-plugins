# AI Tools

The AI add-in of Hearth Office. It adds an AI Tools tab to the document,
spreadsheet and presentation editors and a side panel: a chat beside the
document, and quick actions.

- Chat: questions about the open document, answered by Hearth's Copilot
  with the document's text as it is now, and with the Copilot's search of
  the person's files and notes, PubMed and their References. Chats are
  kept with the person's other Copilot chats. An action the chat proposes
  (saving papers to References, say) is shown with Confirm and Decline.
- Summarise, Key points: the selection, or the whole document, sheet or
  deck.
- Rewrite, Simplify, Expand, Proofread: the selected text.
- Translate: the selection or the whole text, into the language named.
- Suggest title, Contents: from the document's text.
- Draft: new text from an instruction, fitted to the text around the
  cursor (documents, presentations).
- Explain formula: what the active cell's formula works out and how, from
  the cells it uses and their headings (spreadsheets).
- Notes to slides: notes turned into slides on the deck's own layout, with
  speaker notes (presentations).
- A model picker in the panel: the chat models the model proxy offers,
  starting on the person's own model.

Nothing a model writes reaches the document by itself: every answer is
shown in the panel first, and goes in only when its Insert, Replace, Add
as comment or Add slides button is pressed. In a text document an insert
or a replacement is recorded as a tracked change (unless Track change is
unticked), so it can still be accepted or rejected in Review.

## How it reaches a model

The add-in asks Hearth's page, the window the editor is framed in, by
message (../hearth-shared/bridge.js, channel "assistant"). Hearth's page
calls Hearth's API with the person's own session; Hearth checks that its
admins have the editor's assistant on, takes the model the person picked
(one the model proxy offers) and calls the model proxy (LiteLLM), adding
its key on the server. The browser holds no key and calls nothing but
Hearth and the Document Server. The document is passed to the model as
marked material, not as instructions.

Only the tab's button list loads with the document; the rest of the
add-in loads on the first click.

## Files

| File | What it holds |
| --- | --- |
| scripts/main.js | The toolbar tab, loading the rest on first use, the panel, and the path of one request |
| scripts/hearth.js | The way to Hearth: the model list, a quick action, a chat question, a decision |
| scripts/tasks.js | The quick actions as data: where each is offered and how its request is worded |
| scripts/context.js | Reading the document: selection, outline, text at the cursor, cells, slides |
| scripts/apply.js | Putting an accepted answer into the document |
| scripts/markup.js | The small Markdown subset answers use, as HTML or plain text |
| panel.html, scripts/panel.js, panel.css | The side panel |

Tests: `node --test .tests/tasks.test.mjs`.
