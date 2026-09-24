// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.
// XRDICA v0.0.58

// ── Word list loader ──
// Fetches a .txt word list file and parses metadata headers.
//
// Supported headers (lines starting with #):
//   #mode: random | static
//   #title: display title (replaces XRDICA)
//   #subtitle: optional subtitle
//   #alphabet: explicit alphabet string (e.g. abcdefghijklmnopqrstuvwxyzåäö)
//              a leading "\ " (backslash + space) adds SPACE itself as a
//              cipher token, e.g. "#alphabet: \ abcdefghijklmnopqrstuvwxyz"
//              — this lets a puzzle line hide multi-word answers where the
//              space between words must also be solved (e.g. "ICE CREAM").
//              The backslash escapes the character right after it into the
//              alphabet; any other unescaped whitespace in the value is
//              ignored so stray spaces from formatting don't sneak in.
//   #cipher: fixed letter order for debugging (e.g. abcdefghijklmnopqrstuvwxyz = a:1, b:2 ...)
//   #start-lines: initial number of rows shown, static or random mode alike (default/floor 4, see MIN_INITIAL_ROWS below)
//   #max-lines: maximum number of rows, static or random mode alike (default 10)
//   #interval: score points between new rows in random mode (default 50)
//   #penalty: score penalty per incorrect guess on GUESS (default 2)
//   #easy: (bare, no colon needed) — pre-solves the default percentage
//          of starting tiles as an Easy Mode head start (same mechanic
//          as the Random/Numbered Easy Puzzle menu options). "#easy: 10"
//          sets a specific percentage instead (10% here); "#easy: aeiou"
//          pre-solves exactly those letters instead of a percentage —
//          useful for hand-curated puzzles where the author wants full
//          control over which hints to give; "#easy: false" explicitly
//          disables it.
//   #wordlist: an alternate file to draw random-mode words from instead
//              of wordlists/wordlist.txt, e.g. "#wordlist: wordlists/sportsStars.txt"
//              — lets
//              a daily puzzle be themed (a fixed word pool) while still
//              being a genuine random-mode puzzle, deterministic per date
//              like any other daily. If the referenced file uses spaces
//              or accented characters (multi-word names, etc.), give the
//              daily file its own #alphabet header the same way the
//              cities word list does.
//   #theme: a display label for a themed puzzle, e.g. "Sports Stars" —
//           shown between the date and the score.
//
// Words are filtered to contain only letters in the alphabet (or a-z if no
// #alphabet is specified). Words with spaces, digits, or other characters
// are rejected unless #alphabet explicitly includes them.

const DEFAULT_WORDLIST = 'wordlists/wordlist.txt'; // wordlists live in their own subfolder, separate from code
const MIN_INITIAL_ROWS = 4; // never show fewer than this many rows at puzzle start —
                             // solving fewer this fast is vanishingly unlikely and
                             // treated as a sign something's off, not good play

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

// ── Parse a raw #alphabet value into an array of cipher tokens ──
// A backslash escapes the next character into the alphabet as a literal
// token — this is how a space gets included ("\ " → the space token).
// Any other unescaped whitespace is treated as a separator and dropped,
// so accidental double spaces or trailing spaces don't become tokens.
function parseAlphabetTokens(raw) {
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      tokens.push(raw[i + 1]);
      i++; // consume the escaped character too
    } else if (ch === ' ') {
      continue; // unescaped whitespace — not a token
    } else {
      tokens.push(ch);
    }
  }
  return tokens;
}

// Parse the word list file and return a config object
// ── Parse word list from already-fetched text ──
// Optional defaultAlphabet: used as a fallback when the text has no
// #alphabet header of its own — see #wordlist above, where a daily file
// referencing an alternate word pool needs its own alphabet (e.g. for
// space-tokens) to actually apply when that pool is parsed.
async function parseWordListText(text, defaultAlphabet) {
  // Re-use loadWordList logic by creating a blob URL
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const result = await loadWordList(url, defaultAlphabet);
  URL.revokeObjectURL(url);
  return result;
}

async function loadWordList(filename, defaultAlphabet) {
  filename = filename || DEFAULT_WORDLIST;

  const response = await fetch(filename);
  if (!response.ok) throw new Error(`Could not load word list: ${filename}`);
  const text = await response.text();
  // Split on \n, \r\n, OR a lone \r (old-Mac-style line endings) — a
  // file using only \r would otherwise collapse into a single giant
  // "line" here, since \r alone isn't \n and split('\n') wouldn't catch it.
  const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);

  // ── Parse metadata headers ──
  const meta = {
    mode:        'random',
    title:       null,
    titleReveal: null,
    author:      null,
    subtitle:    null,
    alphabet:    defaultAlphabet || null,
    cipher:      null,   // explicit letter order for fixed mapping
    startLines:  MIN_INITIAL_ROWS, // initial number of rows shown, static or random mode alike
    maxLines:    10,   // maximum number of rows shown, static or random mode alike
    interval:    50,
    penalty:     2,    // score penalty per incorrect guess
    minLength:   5,    // minimum word length in random mode
    maxLength:   10,   // maximum word length in random mode
    easy:        false, // Easy Mode pre-solve applied to this puzzle — see #easy below
    wordlist:    null, // alternate file to draw random-mode words from — see #wordlist below
    theme:       null, // display label for a themed puzzle, e.g. "Sports Stars" — see #theme below
  };

  const words = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      // Bare boolean flag — "#easy" alone (no colon) means true. Checked
      // before the colon requirement below, which every other header
      // still needs; this is the only flag that can be written bare.
      if (line.slice(1).trim().toLowerCase() === 'easy') {
        meta.easy = true;
        continue;
      }
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
        case 'alphabet':     meta.alphabet    = value; break; // raw — parsed below (may contain \ escape)
        case 'cipher':      meta.cipher      = value.toLowerCase(); break;
        case 'interval':     meta.interval    = parseInt(value) || 50; break;
        case 'penalty':      meta.penalty     = parseInt(value) ?? 2; break;
        case 'min-length':   meta.minLength   = parseInt(value) || 5; break;
        case 'max-length':   meta.maxLength   = parseInt(value) || 10; break;
        case 'start-lines':  meta.startLines  = Math.max(MIN_INITIAL_ROWS, parseInt(value) || MIN_INITIAL_ROWS); break;
        case 'max-lines':    meta.maxLines    = parseInt(value) || 10; break;
        case 'wordlist':     meta.wordlist    = value; break; // e.g. "wordlists/sportsStars.txt" — see loadWithFallback() in game.js
        case 'theme':        meta.theme       = value; break;
        case 'easy':          {
          const v = value.trim();
          if (/^(true|yes)$/i.test(v)) {
            meta.easy = true; // enabled, use the default percentage
          } else if (/^(false|no)$/i.test(v)) {
            meta.easy = false;
          } else if (/^[a-z]+$/i.test(v)) {
            // A string of letters, e.g. "#easy: aeiou" — pre-solve
            // exactly these letters, wherever they appear, instead of a
            // random percentage-based selection
            meta.easy = v.toLowerCase();
          } else {
            // A number means a specific percentage, e.g. "#easy: 10" = 10%
            const num = parseFloat(v);
            meta.easy = (!isNaN(num) && num > 0) ? Math.min(num, 100) : false;
          }
          break;
        }
      }
    } else {
      // In static/poem mode, preserve the full line including spaces and punctuation.
      // In random mode, lines are single words so lowercasing is fine.
      words.push(line);
    }
  }

  // ── Parse #alphabet into tokens (handles the \ escape for space) ──
  // Letters are lowercased; the space token is left as-is.
  let alphabetTokens = null;
  if (meta.alphabet) {
    alphabetTokens = parseAlphabetTokens(meta.alphabet).map(ch => ch === ' ' ? ch : ch.toLowerCase());
  }

  // ── Determine valid character set ──
  // If #alphabet is given, use it exactly — every token in it is a cipher token.
  // Otherwise default to a-z only.
  let validChars;
  if (alphabetTokens) {
    validChars = new Set(alphabetTokens);  // includes any non-letter tokens like - or space
  } else {
    validChars = new Set('abcdefghijklmnopqrstuvwxyz');
  }

  // ── Filter words ──
  // In random mode: reject words containing characters outside the alphabet.
  // In static/poem mode: preserve all lines — spaces and punctuation are
  // handled at render time; only letters need to be in the alphabet.
  // Tracks the first rejected line/character too, purely for diagnostics
  // if EVERY line ends up rejected (see game.js's "no usable words" error).
  let firstRejectedLine = null;
  let firstRejectedChar = null;
  const filteredWords = words.filter(line => {
    if (!line.trim()) return false;
    if (meta.mode === 'static') return true; // preserve all non-empty lines
    // Random mode: every character must be in validChars
    const lower = line.toLowerCase();
    for (const ch of lower) {
      if (validChars.has(ch)) continue;
      if (validChars.has(stripAccents(ch))) continue;
      if (firstRejectedLine === null) {
        firstRejectedLine = line;
        firstRejectedChar = ch;
      }
      return false;
    }
    return true;
  });

  // ── Build cipher alphabet ──
  // Only characters explicitly in validChars are cipher tokens.
  // Accent-stripped characters map to their base letter's cipher.
  let cipherAlphabet;
  if (alphabetTokens) {
    cipherAlphabet = alphabetTokens;
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
    totalLines: words.length,     // non-empty, non-header lines read, before filtering
    firstRejectedLine,
    firstRejectedChar,
  };
}
