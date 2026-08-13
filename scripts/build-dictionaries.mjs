import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';

const sourceDir = path.resolve(process.argv[2] || '.cache/dictionaries');
const outputDir = path.resolve('dictionaries');
fs.mkdirSync(outputDir, { recursive: true });

function store(source, license) {
  return { source, license, entries: [], index: Object.create(null) };
}

function normalize(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

function addEntry(dictionary, keys, display, reading, definition) {
  display = normalize(display);
  reading = normalize(reading);
  definition = normalize(definition);
  if (!display || !definition) return;
  const id = dictionary.entries.length;
  dictionary.entries.push([display, reading, definition]);
  for (const rawKey of keys) {
    const key = normalize(rawKey);
    if (!key) continue;
    const ids = dictionary.index[key] || (dictionary.index[key] = []);
    if (ids.length < 8) ids.push(id);
  }
}

async function lines(input) {
  return readline.createInterface({ input, crlfDelay: Infinity });
}

function cleanEdictGloss(value) {
  return value
    .replace(/^\((?:[^()]|\([^)]*\))*\)\s*/g, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
}

async function buildJapanese() {
  const dictionary = store('JMdict/EDICT2 by the Electronic Dictionary Research and Development Group', 'EDRDG dictionary licence');
  const input = fs.createReadStream(path.join(sourceDir, 'edict2u.gz')).pipe(createGunzip());
  for await (const line of await lines(input)) {
    if (!line || line.startsWith('　？？？')) continue;
    const separator = line.indexOf(' /');
    if (separator < 0) continue;
    const heading = line.slice(0, separator).trim();
    const readingMatch = heading.match(/\[([^\]]+)\]/);
    const formsText = heading.slice(0, readingMatch?.index ?? heading.length).trim();
    const forms = formsText.split(';').map(value => value.replace(/\([^)]*\)$/g, '').trim()).filter(Boolean);
    const readings = (readingMatch?.[1] || '').split(';').map(value => value.replace(/\([^)]*\)$/g, '').trim()).filter(Boolean);
    const glosses = line.slice(separator + 2).split('/').map(cleanEdictGloss)
      .filter(value => value && !/^EntL\d+[A-Z]*$/i.test(value) && !/^See\s/i.test(value)).slice(0, 5);
    const display = forms[0] || readings[0];
    addEntry(dictionary, [...forms, ...readings], display, readings[0] || '', glosses.join('; '));
  }
  return dictionary;
}

async function buildChinese() {
  const dictionary = store('CC-CEDICT, published by MDBG', 'Creative Commons Attribution-ShareAlike 3.0');
  const input = fs.createReadStream(path.join(sourceDir, 'cedict_ts.u8'));
  for await (const line of await lines(input)) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/$/);
    if (!match) continue;
    const [, traditional, simplified, pinyin, glossText] = match;
    const glosses = glossText.split('/').map(value => value.trim()).filter(Boolean).slice(0, 5);
    addEntry(dictionary, [traditional, simplified], simplified, pinyin, glosses.join('; '));
  }
  return dictionary;
}

async function buildKorean() {
  const dictionary = store("Kengdic, Joe Speigle's Korean/English dictionary database", 'MPL 2.0');
  const input = fs.createReadStream(path.join(sourceDir, 'kengdic.tsv'));
  let first = true;
  for await (const line of await lines(input)) {
    if (first) { first = false; continue; }
    const [, surface, hanja, gloss] = line.split('\t');
    if (!surface || !gloss) continue;
    addEntry(dictionary, [surface, hanja], surface, hanja || '', gloss);
  }
  return dictionary;
}

for (const [name, build] of [['japan', buildJapanese], ['china', buildChinese], ['korea', buildKorean]]) {
  const dictionary = await build();
  const output = path.join(outputDir, `${name}.json.gz`);
  fs.writeFileSync(output, gzipSync(JSON.stringify(dictionary), { level: 9 }));
  console.log(`${name}: ${dictionary.entries.length.toLocaleString()} entries -> ${output}`);
}
