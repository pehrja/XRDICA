// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.
// XRDICA v0.0.37

// ── Core word and cipher utilities ──
// These functions operate on the data returned by loader.js.

// ── Seeded random number generator (Mulberry32) ──
// Given the same seed, always produces the same sequence.
// Returns a function that behaves like Math.random().
function seededRandom(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Global random function — replaced with seeded version when a seed is set
let rng = Math.random.bind(Math);

function setRng(seed) {
  rng = seededRandom(seed);
}

// ── Deterministic seed from an arbitrary string (e.g. a filename) ──
// Same string always produces the same seed — used so a specific
// puzzle file (not dated, not explicitly ?seed=) still shuffles its
// cipher identically for everyone, every time it's loaded.
function hashStringToSeed(str) {
  let hash = 5381; // djb2
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
    hash = hash | 0; // keep it a 32-bit int
  }
  return Math.abs(hash) || 1; // never 0
}

// ── Fisher-Yates shuffle (uses rng) ──
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Build the letter → cipher number mapping ──
// If fixedCipher is provided (e.g. 'abcdefghijklmnopqrstuvwxyz'),
// the position of each letter in that string defines its number:
// a=1, b=2, c=3 ... giving a completely predictable, stable mapping.
// Without fixedCipher, numbers are randomly shuffled (normal gameplay).
function buildLetterMap(cipherAlphabet, fixedCipher) {
  const map = {};
  if (fixedCipher) {
    // Fixed mapping: position in fixedCipher string = cipher number
    cipherAlphabet.forEach(letter => {
      const pos = fixedCipher.indexOf(letter);
      map[letter] = pos !== -1 ? pos + 1 : null;
    });
  } else {
    // Random mapping: shuffle numbers 1..n across the alphabet
    const numbers = cipherAlphabet.map((_, i) => i + 1);
    shuffle(numbers);
    cipherAlphabet.forEach((letter, i) => { map[letter] = numbers[i]; });
  }
  return map;
}

// ── Get cipher token for a character ──
// If the char is directly in the map, return its cipher.
// Otherwise strip accents and return the base letter's cipher.
function getCipherToken(ch, letterMap, validChars) {
  if (letterMap[ch] !== undefined) return ch;
  const base = stripAccents(ch);
  if (letterMap[base] !== undefined) return base;
  return null;
}

// ── Pick a random word from the list ──
function getRandomWord(wordList) {
  return wordList[Math.floor(rng() * wordList.length)];
}

// ── Pick a random word with at least one unsolved cipher ──
// Superseded for gameplay by precomputeWordSequence() below (which is
// fully deterministic and doesn't depend on live solve state) — kept
// here in case it's useful for other tooling.
function getRandomUnsolvedWord(wordList, usedWords, letterMap, validChars, minLen, maxLen) {
  minLen = minLen || 5;
  maxLen = maxLen || 10;
  const candidates = wordList.filter(w => {
    if (usedWords.has(w)) return false;
    if (w.length < minLen || w.length > maxLen) return false;
    return w.split('').some(ch => {
      const token = getCipherToken(ch, letterMap, validChars);
      if (!token) return false;
      const cipher = String(letterMap[token]);
      return !document.querySelector(`.tile[data-cipher="${cipher}"][data-locked]`);
    });
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// ── Precompute a full, deterministic word sequence for random mode ──
// Every player on the same seed sees the exact same words in the exact
// same order — selection never depends on solve state, only on the
// seeded RNG. Within a sliding window of the last `windowSize` rows,
// candidate words are weighted toward covering letters that haven't
// appeared recently, so e.g. AARDVARK isn't immediately followed by
// another A-heavy word — without ever hard-excluding a candidate
// (avoids drifting toward obscure, rare-letter-heavy words once common
// letters are used up).
function precomputeWordSequence(wordList, letterMap, validChars, minLen, maxLen, count, windowSize) {
  minLen = minLen || 5;
  maxLen = maxLen || 10;
  windowSize = windowSize || 3;

  // Filter once: right length, and has at least one letter that's part
  // of this puzzle's cipher alphabet (membership only — not solve state).
  const pool = wordList.filter(w => {
    if (w.length < minLen || w.length > maxLen) return false;
    return w.split('').some(ch => getCipherToken(ch, letterMap, validChars) !== null);
  });

  const sequence = [];
  const used = new Set();
  const recentLetterSets = []; // last `windowSize` rows' distinct letters

  for (let i = 0; i < count; i++) {
    const candidates = pool.filter(w => !used.has(w));
    if (candidates.length === 0) break; // pool exhausted — sequence ends early

    // How often has each letter shown up within the current window?
    const recentCounts = {};
    for (const letters of recentLetterSets) {
      for (const ch of letters) recentCounts[ch] = (recentCounts[ch] || 0) + 1;
    }

    // Score each candidate: higher when its distinct letters are less
    // represented in the recent window.
    const weights = candidates.map(w => {
      const letters = new Set(w.split(''));
      let score = 0;
      letters.forEach(ch => { score += 1 / (1 + (recentCounts[ch] || 0)); });
      return score;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let pick = candidates[candidates.length - 1]; // fallback for float rounding
    if (totalWeight > 0) {
      let r = rng() * totalWeight;
      for (let j = 0; j < candidates.length; j++) {
        r -= weights[j];
        if (r <= 0) { pick = candidates[j]; break; }
      }
    } else {
      pick = candidates[Math.floor(rng() * candidates.length)];
    }

    sequence.push(pick);
    used.add(pick);
    recentLetterSets.push(new Set(pick.split('')));
    if (recentLetterSets.length > windowSize) recentLetterSets.shift();
  }

  return sequence;
}
