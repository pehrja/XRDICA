// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.

// ── Core word and cipher utilities ──
// These functions operate on the data returned by loader.js.

// ── Fisher-Yates shuffle ──
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
  return wordList[Math.floor(Math.random() * wordList.length)];
}

// ── Pick a random word with at least one unsolved cipher ──
function getRandomUnsolvedWord(wordList, usedWords, letterMap, validChars) {
  const candidates = wordList.filter(w => {
    if (usedWords.has(w)) return false;
    return w.split('').some(ch => {
      const token = getCipherToken(ch, letterMap, validChars);
      if (!token) return false;
      const cipher = String(letterMap[token]);
      return !document.querySelector(`.tile[data-cipher="${cipher}"][data-locked]`);
    });
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
