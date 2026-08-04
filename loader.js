// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.

// ── Word list loader ──
// Fetches a .txt word list file and parses metadata headers.
//
// Supported headers (lines starting with #):
//   #mode: random | static
//   #title: display title (replaces XRDICA)
//   #subtitle: optional subtitle
//   #alphabet: explicit alphabet string (e.g. abcdefghijklmnopqrstuvwxyzåäö)
//   #cipher: fixed letter order for debugging (e.g. abcdefghijklmnopqrstuvwxyz = a:1, b:2 ...)
//   #rows: initial number of rows in random mode (default 5)
//   #max-rows: maximum rows in random mode (default 10)
//   #interval: score points between new rows in random mode (default 60)
//   #penalty: score penalty per incorrect guess on GUESS (default 2)
//
// Words are filtered to contain only letters in the alphabet (or a-z if no
// #alphabet is specified). Words with spaces, digits, or other characters
// are rejected unless #alphabet explicitly includes them.

const DEFAULT_WORDLIST = 'wordlist.txt';

// Accent → base letter map for display normalization
const ACCENT_MAP = {
  'à':'a','á':'a','â':'a','ã':'a','ä':'a','å':'a',
  'è':'e','é':'e','ê':'e','ë':'e',
  'ì':'i','í':'i','î':'i','ï':'i',
  'ò':'o','ó':'o','ô':'o','õ':'o','ö':'o','ø':'o',
  'ù':'u','ú':'u','û':'u','ü':'u',
  'ý':'y','ÿ':'y',
  'ñ':'n','ç':'c','ß':'ss',
  'æ':'ae','œ':'oe'
};

// Strip accents from a string, mapping to base letters
function stripAccents(str) {
  return str.split('').map(ch => ACCENT_MAP[ch] || ch).join('');
}

// Parse the word list file and return a config object
async function loadWordList(filename) {
  filename = filename || DEFAULT_WORDLIST;

  const response = await fetch(filename);
  if (!response.ok) throw new Error(`Could not load word list: ${filename}`);
  const text = await response.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // ── Parse metadata headers ──
  const meta = {
    mode:        'random',
    title:       null,
    titleReveal: null,
    author:      null,
    subtitle:    null,
    alphabet:    null,
    cipher:      null,   // explicit letter order for fixed mapping
    rows:        5,
    maxRows:     10,
    startLines:  1,    // static mode: initial number of lines shown
    maxLines:    12,   // static mode: maximum number of lines shown
    interval:    60,
    penalty:     2,    // score penalty per incorrect guess
  };

  const words = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key   = line.slice(1, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      switch (key) {
        case 'mode':         meta.mode        = value.toLowerCase(); break;
        case 'title':        meta.title       = value; break;
        case 'title-reveal': meta.titleReveal = value; break;
        case 'author':       meta.author      = value; break;
        case 'subtitle':     meta.subtitle    = value; break;
        case 'alphabet':     meta.alphabet    = value.toLowerCase(); break;
        case 'cipher':      meta.cipher      = value.toLowerCase(); break;
        case 'rows':         meta.rows        = parseInt(value) || 5; break;
        case 'max-rows':     meta.maxRows     = parseInt(value) || 10; break;
        case 'interval':     meta.interval    = parseInt(value) || 60; break;
        case 'penalty':      meta.penalty     = parseInt(value) ?? 2; break;
        case 'start-lines':  meta.startLines  = parseInt(value) || 1; break;
        case 'max-lines':    meta.maxLines    = parseInt(value) || 12; break;
      }
    } else {
      // In static/poem mode, preserve the full line including spaces and punctuation.
      // In random mode, lines are single words so lowercasing is fine.
      words.push(line);
    }
  }

  // ── Determine valid character set ──
  // If #alphabet is given, use it exactly — every character in it is a cipher token.
  // Otherwise default to a-z only.
  let validChars;
  if (meta.alphabet) {
    validChars = new Set(meta.alphabet.split(''));  // includes any non-letter chars like -
  } else {
    validChars = new Set('abcdefghijklmnopqrstuvwxyz');
  }

  // ── Filter words ──
  // In random mode: reject words containing characters outside the alphabet.
  // In static/poem mode: preserve all lines — spaces and punctuation are
  // handled at render time; only letters need to be in the alphabet.
  const filteredWords = words.filter(line => {
    if (!line.trim()) return false;
    if (meta.mode === 'static') return true; // preserve all non-empty lines
    // Random mode: every character must be in validChars
    return line.toLowerCase().split('').every(ch => {
      if (validChars.has(ch)) return true;
      const base = stripAccents(ch);
      return validChars.has(base);
    });
  });

  // ── Build cipher alphabet ──
  // Only characters explicitly in validChars are cipher tokens.
  // Accent-stripped characters map to their base letter's cipher.
  let cipherAlphabet;
  if (meta.alphabet) {
    cipherAlphabet = meta.alphabet.split('');
  } else {
    // Discover from filtered words — only count letter characters
    const charSet = new Set();
    filteredWords.forEach(w => w.toLowerCase().split('').forEach(ch => {
      if (validChars.has(ch)) { charSet.add(ch); return; }
      const base = stripAccents(ch);
      if (validChars.has(base)) charSet.add(base);
    }));
    cipherAlphabet = Array.from(charSet).sort();
  }

  return {
    meta,
    words: filteredWords,
    cipherAlphabet,
    validChars,
  };
}
