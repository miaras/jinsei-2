import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const FILES = { japan: 'japan.json.gz', china: 'china.json.gz', korea: 'korea.json.gz', hanja: 'korea.json.gz' };
const globalState = globalThis;
const cache = globalState.__jinseiDictionaryCache || new Map();
if (process.env.NODE_ENV !== 'production') globalState.__jinseiDictionaryCache = cache;

function cleanTerm(value) {
  return String(value || '').normalize('NFC').trim()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

function loadDictionary(country) {
  const key = country === 'hanja' ? 'korea' : country;
  if (cache.has(key)) return cache.get(key);
  const filename = FILES[key];
  if (!filename) return null;
  const compressed = fs.readFileSync(path.join(process.cwd(), 'dictionaries', filename));
  const dictionary = JSON.parse(gunzipSync(compressed).toString('utf8'));
  cache.set(key, dictionary);
  return dictionary;
}

function koreanCandidates(input) {
  const term = cleanTerm(input);
  const candidates = [];
  const add = value => { value = cleanTerm(value); if (value && !candidates.includes(value)) candidates.push(value); };
  let base = term;

  // Strip Korean case/topic particles before looking up nouns.
  const particle = base.match(/^(.*?)(?:으로부터|에게서|한테서|으로써|으로서|이라도|까지|부터|처럼|보다|에게|한테|께서|에서|으로|로|과|와|의|도|만|은|는|이|가|을|를|에)$/u);
  if (particle?.[1]) base = particle[1];
  // Common 하다 contractions and polite/past endings.
  const hada = base.match(/^(.*?)(?:하셨어요|하였어요|했어요|합니다|해요|했다|한다|하고|하면|해서)$/u);
  if (hada?.[1]) add(`${hada[1]}하다`);

  const endings = [
    /^(.*?)(?:으셨습니다|셨습니다|었습니다|았습니다|였어요|었어요|았어요)$/u,
    /^(.*?)(?:습니다|습니까|세요|어요|아요|네요|군요)$/u,
    /^(.*?)(?:으면서|으니까|으려고|으므로|지만|는데|고서|거나|면서|니까|려고|므로|다면|면|고)$/u,
    /^(.*?)(?:는다|ㄴ다)$/u
  ];
  for (const pattern of endings) {
    const match = base.match(pattern);
    if (match?.[1]) add(`${match[1]}다`);
  }
  add(base);
  if (!base.endsWith('다')) add(`${base}다`);
  add(term);
  return candidates;
}

function genericCandidates(input) {
  const term = cleanTerm(input);
  const candidates = [term];
  if (term.length > 1 && term.length <= 12) {
    for (let length = term.length - 1; length >= 1; length--) {
      for (let start = 0; start + length <= term.length; start++) {
        const part = term.slice(start, start + length);
        if (!candidates.includes(part)) candidates.push(part);
      }
    }
  }
  return candidates;
}

export function lookupDictionary(country, input) {
  const dictionary = loadDictionary(country);
  const query = cleanTerm(input);
  if (!dictionary || !query) return null;
  const candidates = country === 'korea' || country === 'hanja' ? koreanCandidates(query) : genericCandidates(query);
  for (const candidate of candidates) {
    const ids = dictionary.index[candidate];
    if (!ids?.length) continue;
    return {
      query,
      normalized: candidate,
      results: ids.slice(0, 8).map(id => {
        const [term, reading, definition] = dictionary.entries[id];
        return { term, reading, definition };
      }),
      source: dictionary.source,
      license: dictionary.license
    };
  }
  return { query, normalized: candidates[0] || query, results: [], source: dictionary.source, license: dictionary.license };
}
