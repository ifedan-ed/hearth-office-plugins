# Thesaurus

Synonyms in Hearth Office's editors, offline: a Thesaurus button in the
Review tab and Synonyms in the right-click menu open a side panel with the
word's meanings and their synonyms; pressing one puts it in place of the
word.

- The data are the OpenOffice and LibreOffice thesauruses (MyThes format,
  from the dictionaries repository; English from WordNet), turned at image
  build time into small files by .dev/build-data.mjs and served by the
  Document Server itself. Nothing is sent anywhere.
- English first. Another language is a data pack: one line in Hearth
  Office's hearth/thesaurus.txt naming its .dat file. With more than one
  pack the panel offers a language list.
- A word not found as written is looked for in its plain form (studies,
  study; running, run).

Tests: `node --test .tests/lookup.test.mjs`.
