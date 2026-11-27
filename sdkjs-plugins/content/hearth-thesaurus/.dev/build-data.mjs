// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// node build-data.mjs OUT CODE NAME DAT [CODE NAME DAT ...]
// node build-data.mjs OUT --list LIST ROOT
//
// The second form reads the packs from LIST (Hearth Office's
// hearth/thesaurus.txt: "code|name|file" lines, # comments), the files
// under ROOT (the dictionaries repository).
//
// Turns OpenOffice/LibreOffice thesauruses (the MyThes .dat format, as in
// the dictionaries repository: th_*.dat, en_US_thes.dat) into the
// Thesaurus add-in's data packs: OUT/<CODE>/index.json and small shards,
// so a lookup fetches one file of a few kilobytes instead of the whole
// 12 MB, and only from the Document Server itself (nothing is ever sent
// out: the data is in the image).
//
// A .dat file starts with its encoding (ISO8859-1, UTF-8, KOI8-U...) on
// the first line; then each entry is "word|n" followed by n lines of
// "(part of speech)|synonym|synonym...". Words are keyed by their lower
// case. Shards are cut by the key's first letters: a prefix whose words
// pass SHARD_BYTES is split by one more letter, so every shard stays
// small whatever the language.
//
// OUT/packs.json lists the packs built, for the add-in's language list.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHARD_BYTES = 96 * 1024

/** read parses one .dat file into Map(key -> [{ word, meanings: [[pos, [synonyms]]] }]). */
export function read(bytes) {
  const firstEnd = bytes.indexOf(10)
  const label = new TextDecoder('utf-8').decode(bytes.subarray(0, firstEnd)).replace(/^﻿/, '').trim()
  const enc = { 'ISO8859-1': 'latin1', 'ISO8859-15': 'iso-8859-15', 'KOI8-U': 'koi8-u', 'KOI8-R': 'koi8-r', 'UTF-8': 'utf-8', 'CP1256': 'windows-1256' }[label.toUpperCase()] ?? 'utf-8'
  const lines = new TextDecoder(enc).decode(bytes.subarray(firstEnd + 1)).split(/\r?\n/)
  const out = new Map()
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].split('|')
    const n = Number(head[1])
    if (head.length !== 2 || !head[0] || !Number.isInteger(n)) continue
    const meanings = []
    for (let k = 0; k < n && i + 1 < lines.length; k++) {
      const parts = lines[++i].split('|').map((s) => s.trim()).filter(Boolean)
      if (!parts.length) continue
      const pos = /^\(.*\)$/.test(parts[0]) ? parts.shift().slice(1, -1) : ''
      const syns = parts.filter((s) => s.toLowerCase() !== head[0].toLowerCase())
      if (syns.length) meanings.push([pos, syns])
    }
    if (!meanings.length) continue
    const key = head[0].toLowerCase()
    const list = out.get(key) ?? []
    list.push({ word: head[0], meanings })
    out.set(key, list)
  }
  return out
}

/** prefixOf is a key's first `len` characters, '_' standing for any that is not a letter. */
export function prefixOf(key, len) {
  return [...key].slice(0, len).map((c) => (/\p{L}/u.test(c) ? c : '_')).join('').padEnd(1, '_')
}

/** shard cuts the entries into shards: Map(prefix -> object of key -> entries). */
export function shard(entries) {
  const result = new Map()
  const cut = (keys, len) => {
    const groups = new Map()
    for (const k of keys) {
      const p = prefixOf(k, len)
      if (!groups.has(p)) groups.set(p, [])
      groups.get(p).push(k)
    }
    for (const [p, ks] of groups) {
      const obj = Object.fromEntries(ks.map((k) => [k, entries.get(k)]))
      const size = Buffer.byteLength(JSON.stringify(obj))
      // A prefix as long as some of its keys cannot be split further.
      if (size > SHARD_BYTES && ks.some((k) => [...k].length > len)) cut(ks, len + 1)
      else result.set(p, obj)
    }
  }
  cut([...entries.keys()], 1)
  return result
}

/** fromList reads a pack list into [code, name, file under root, ...]. */
export function fromList(text, root) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).flatMap((l) => {
    const [code, name, file] = l.split('|')
    if (!code || !name || !file) throw new Error('not "code|name|file": ' + l)
    return [code, name, join(root, file)]
  })
}

function main(argv) {
  if (argv[1] === '--list') argv = [argv[0], ...fromList(readFileSync(argv[2], 'utf8'), argv[3])]
  const [out, ...rest] = argv
  if (!out || rest.length === 0 || rest.length % 3) {
    console.error('usage: build-data.mjs OUT CODE NAME DAT [CODE NAME DAT ...]')
    process.exit(2)
  }
  const packs = []
  for (let i = 0; i < rest.length; i += 3) {
    const [code, name, dat] = rest.slice(i, i + 3)
    const entries = read(readFileSync(dat))
    const shards = shard(entries)
    const dir = join(out, code)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const prefixes = [...shards.keys()].sort()
    prefixes.forEach((p, n) => writeFileSync(join(dir, n + '.json'), JSON.stringify(shards.get(p))))
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ code, name, words: entries.size, prefixes }))
    packs.push({ code, name })
    console.log(`${code}: ${entries.size} words in ${prefixes.length} shards`)
  }
  writeFileSync(join(out, 'packs.json'), JSON.stringify(packs))
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
