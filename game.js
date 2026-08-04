// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.

// ── Game state ──
let WORD_LIST     = [];
let LETTER_MAP    = {};
let VALID_CHARS   = new Set();
let GAME_MODE     = 'random';
let INITIAL_ROWS  = 5;
let MAX_ROWS      = 10;
let NEW_ROW_EVERY = 60;

let totalRows  = 0;
let activeRow  = 0;
let activeCol  = 0;
let pendingRed = false;
let gameOver   = false;
let paused     = false;
let score      = 0;
let lastRowAddedAtScore = 0;
let PENALTY = 2;
let STATIC_LINES = [];   // all lines from file in order
let STATIC_NEXT = 0;     // index of next line to reveal
let STATIC_MAX = 12;     // max lines to show
const usedWords = new Set();

let scoreTimer   = null;
let titleReveal  = null;
let puzzleAuthor = null;

// ── Bootstrap ──
const urlParams    = new URLSearchParams(window.location.search);
const wordListFile = urlParams.get('list') || 'daily.txt';

loadWordList(wordListFile).then(({ meta, words, cipherAlphabet, validChars }) => {
  WORD_LIST   = words;
  VALID_CHARS = validChars;
  GAME_MODE   = meta.mode;
  LETTER_MAP  = buildLetterMap(cipherAlphabet, meta.cipher || null);

  if (meta.mode === 'random') {
    INITIAL_ROWS  = meta.rows;
    MAX_ROWS      = meta.maxRows;
    NEW_ROW_EVERY = meta.interval;
  }
  PENALTY = meta.penalty ?? 2;

  // Store reveal info for game over
  titleReveal  = meta.titleReveal || null;
  puzzleAuthor = meta.author || null;

  // Title: use today's date (static mode) or provided title (random mode)
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  if (meta.mode === 'static') {
    const displayTitle = meta.title ? `${meta.title} ${today}` : today;
    document.getElementById('game-title').textContent = 'XRDICA';
    document.title = 'XRDICA';
    document.getElementById('game-subtitle').textContent = displayTitle;
    document.getElementById('game-subtitle').style.display = 'block';
  } else {
    if (meta.title) {
      document.getElementById('game-title').textContent = meta.title.toUpperCase();
      document.title = meta.title;
    }
    if (meta.subtitle) {
      document.getElementById('game-subtitle').textContent = meta.subtitle;
      document.getElementById('game-subtitle').style.display = 'block';
    }
  }

  buildKeyboard(cipherAlphabet);

  if (meta.mode === 'static') {
    STATIC_LINES = words;
    STATIC_MAX   = meta.maxLines  || 12;
    STATIC_NEXT  = meta.startLines || 1;
    // Add only the initial lines
    const startCount = Math.min(meta.startLines || 1, words.length);
    for (let r = 0; r < startCount; r++) addRow(r, words[r]);
  } else {
    for (let r = 0; r < INITIAL_ROWS; r++) addRow(r);
  }

  scoreTimer = setInterval(() => addScore(1), 5000);
  fitGridToScreen();
  // Update mode button label
  const modeBtn = document.getElementById('mode-btn');
  if (modeBtn) {
    const isRandom = wordListFile === 'wordlist.txt';
    modeBtn.textContent = isRandom ? '📅 Daily' : '⚄ Random';
  }

  setActiveTile(0, 0);

  console.log('--- Xrdica grid ---');
  document.querySelectorAll('.row').forEach((row, i) => {
    console.log(`Row ${i+1} (${row.dataset.length} letters): ${row.dataset.word}`);
  });

}).catch(err => {
  console.error('Failed to load word list:', err);
  console.error('Word list file attempted:', wordListFile);
  document.getElementById('grid').textContent = `Error loading word list: ${err.message}`;
});

// ── Scoring ──
function addScore(points) {
  if (gameOver || paused) return;
  score += points;
  document.getElementById('score-value').textContent = score;

  if (GAME_MODE === 'random' && totalRows < MAX_ROWS &&
      score - lastRowAddedAtScore >= NEW_ROW_EVERY) {
    lastRowAddedAtScore = score;
    addRow(totalRows);
  } else if (GAME_MODE === 'static' && STATIC_NEXT < STATIC_LINES.length &&
             totalRows < STATIC_MAX &&
             score - lastRowAddedAtScore >= NEW_ROW_EVERY) {
    lastRowAddedAtScore = score;
    addRow(totalRows, STATIC_LINES[STATIC_NEXT]);
    STATIC_NEXT++;
  }
}

// ── Parse a poem line into segments ──
// A character is a cipher token if it appears in VALID_CHARS (the alphabet).
// Spaces are gaps. Everything else is punctuation displayed between tiles.
function parseLine(line) {
  const segments = [];
  for (const ch of line) {
    const lower = ch.toLowerCase();
    if (ch === ' ') {
      segments.push({ type: 'space' });
    } else if (VALID_CHARS.has(lower) || (ACCENT_MAP[lower] && VALID_CHARS.has(ACCENT_MAP[lower]))) {
      segments.push({ type: 'letter', ch: lower });
    } else {
      segments.push({ type: 'punct', ch });
    }
  }
  return segments;
}

// ── Add a row to the grid ──
function addRow(r, forcedWord) {
  let word;
  if (forcedWord !== undefined) {
    word = forcedWord;
    usedWords.add(word);
  } else {
    word = getRandomUnsolvedWord(WORD_LIST, usedWords, LETTER_MAP, VALID_CHARS);
    if (!word) return;
    usedWords.add(word);
  }

  const rowWrap = document.createElement('div');
  rowWrap.classList.add('row-wrap');
  rowWrap.id = `wrap-${r}`;

  const row = document.createElement('div');
  row.classList.add('row');
  row.id = `row-${r}`;
  row.dataset.word   = word;
  row.dataset.solved = 'false';

  const segments  = parseLine(word);
  let tileCount   = 0;

  for (const seg of segments) {
    if (seg.type === 'space') {
      const space = document.createElement('div');
      space.classList.add('word-space');
      row.appendChild(space);

    } else if (seg.type === 'punct') {
      const punct = document.createElement('div');
      punct.classList.add('punct-marker');
      punct.textContent = seg.ch;
      row.appendChild(punct);

    } else {
      const c      = tileCount++;
      const ch     = seg.ch;
      const token  = getCipherToken(ch, LETTER_MAP, VALID_CHARS);
      const cipher = token ? String(LETTER_MAP[token]) : '?';

      const tile = document.createElement('div');
      tile.classList.add('tile');
      tile.id = `tile-${r}-${c}`;
      tile.dataset.letter = token || ch;
      tile.dataset.cipher = cipher;
      tile.dataset.row    = r;
      tile.dataset.col    = c;

      const solvedTile = document.querySelector(`.tile[data-cipher="${cipher}"][data-locked]`);
      if (solvedTile) {
        tile.dataset.locked = true;
        tile.dataset.guess  = solvedTile.dataset.guess;
        tile.classList.add('correct');
      }

      renderTile(tile);

      tile.addEventListener('click', () => {
        clearRedTiles();
        setActiveTile(parseInt(tile.dataset.row), parseInt(tile.dataset.col), true);
      });

      row.appendChild(tile);
    }
  }

  row.dataset.length = tileCount;

  rowWrap.appendChild(row);
  document.getElementById('grid').appendChild(rowWrap);
  totalRows++;
  checkRowIndirectlySolved(r);
  fitGridToScreen();
}

// ── Render a tile ──
function renderTile(tile) {
  tile.innerHTML = '';

  if (tile.dataset.guess) {
    const letterEl = document.createElement('span');
    letterEl.classList.add('letter');
    letterEl.textContent = tile.dataset.guess.toUpperCase();
    tile.appendChild(letterEl);
  }

  const cipherEl = document.createElement('span');
  cipherEl.classList.add('cipher');
  cipherEl.textContent = tile.dataset.cipher;
  tile.appendChild(cipherEl);
}

// ── Render a tile with a hint ──
function renderTileWithHint(tile) {
  tile.innerHTML = '';

  const cipherEl = document.createElement('span');
  cipherEl.classList.add('cipher');
  cipherEl.textContent = tile.dataset.cipher;
  tile.appendChild(cipherEl);

  if (tile.dataset.hint) {
    const hintEl = document.createElement('span');
    hintEl.classList.add('hint');
    hintEl.textContent = tile.dataset.hint.toUpperCase();
    tile.appendChild(hintEl);
  }
}

// ── Render a same-cipher tile — shows guessed letter above cipher, orange tinted ──
function renderSameCipherTile(tile, guess) {
  tile.innerHTML = '';

  const letterEl = document.createElement('span');
  letterEl.classList.add('letter');
  letterEl.textContent = guess.toUpperCase();
  tile.appendChild(letterEl);

  const cipherEl = document.createElement('span');
  cipherEl.classList.add('cipher');
  cipherEl.textContent = tile.dataset.cipher;
  tile.appendChild(cipherEl);
}

// ── Build on-screen keyboard ──
function buildKeyboard(alphabet) {
  const keyboard = document.getElementById('keyboard');
  keyboard.innerHTML = '';

  const qwertyRows = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⌫','z','x','c','v','b','n','m','Enter']
  ];

  const alphabetSet    = new Set(alphabet);
  const coveredByQwerty = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
  const extraLetters   = alphabet.filter(ch => !coveredByQwerty.has(ch));

  if (extraLetters.length > 0) {
    const lastRow   = qwertyRows[2];
    const enterIdx  = lastRow.indexOf('Enter');
    lastRow.splice(enterIdx, 0, ...extraLetters);
  }

  qwertyRows.forEach(rowKeys => {
    const rowEl = document.createElement('div');
    rowEl.classList.add('kb-row');

    rowKeys.forEach(k => {
      if (k.length === 1 && /[a-z]/.test(k) && !alphabetSet.has(k)) return;

      const btn = document.createElement('button');
      btn.classList.add('key');
      btn.textContent = k.toUpperCase();
      btn.dataset.key = k;
      if (k === 'Enter' || k === '⌫') btn.classList.add('wide');
      btn.addEventListener('click', () => handleKeyInput(k));
      rowEl.appendChild(btn);
    });

    keyboard.appendChild(rowEl);
  });
}

// ── Update keyboard colours — green for confirmed only ──
function updateKeyboard() {
  document.querySelectorAll('.key').forEach(btn => {
    const k = btn.dataset.key;
    if (!k || k === 'Enter' || k === '⌫') return;
    btn.classList.remove('key-correct', 'key-guessed', 'key-wrong');
    const locked = document.querySelector(`.tile[data-letter="${k}"][data-locked]`);
    if (locked) btn.classList.add('key-correct');
  });
}

// ── Update Enter key — green when there are uncommitted guesses ──
function updateEnterKey() {
  const enterBtn = document.querySelector('.key[data-key="Enter"]');
  if (!enterBtn) return;
  const hasGuesses = Array.from(document.querySelectorAll('.tile:not([data-locked])')).some(t => t.dataset.guess);
  enterBtn.classList.toggle('key-correct', hasGuesses);
}

// ── Handle input ──
function handleKeyInput(k) {
  if (gameOver || paused) return;

  if (k === '⌫' || k === 'Backspace' || k === 'Delete' || k === ' ') {
    clearRedTiles();
    clearGuess(activeRow, activeCol);
    if (k !== ' ') moveActive('left');
    addScore(1);
    return;
  }

  if (k === 'Enter') {
    commitGuess();
    return;
  }

  const letter = k.toLowerCase();
  if (LETTER_MAP[letter] !== undefined) {
    clearRedTiles();
    recordGuess(activeRow, activeCol, letter);
    advanceActive();
    addScore(1);
    updateKeyboard();
  }
}

// ── Physical keyboard ──
document.addEventListener('keydown', e => {
  if (gameOver || paused) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); clearRedTiles(); moveActive('left');  return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); clearRedTiles(); moveActive('right'); return; }
  if (e.key === 'ArrowUp')    { e.preventDefault(); clearRedTiles(); moveActive('up');    return; }
  if (e.key === 'ArrowDown')  { e.preventDefault(); clearRedTiles(); moveActive('down');  return; }

  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === ' ' ||
      e.key === 'Enter') {
    e.preventDefault();
    handleKeyInput(e.key);
    return;
  }

  const letter = e.key.toLowerCase();
  if (LETTER_MAP[letter] !== undefined) {
    handleKeyInput(letter);
  }
});

// ── Set active tile ──
// explicit=true means the player clicked — show same-cipher highlights
// explicit=false means auto-advance — no highlights
function setActiveTile(r, c, explicit) {
  document.querySelectorAll('.tile.active').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tile.same-cipher').forEach(t => t.classList.remove('same-cipher'));

  activeRow = r;
  activeCol = c;

  const tile = document.getElementById(`tile-${r}-${c}`);
  if (tile) {
    tile.classList.add('active');
    if (explicit) {
      // Highlight all same-cipher tiles
      const cipher = tile.dataset.cipher;
      document.querySelectorAll(`.tile:not([data-locked])`).forEach(t => {
        if (t.dataset.cipher === cipher && t.id !== tile.id) {
          t.classList.add('same-cipher');
        }
      });
    }
  }
  updateKeyboard();
}

// ── Advance active tile, skipping locked, stopping on full loop ──
function advanceActive() {
  const rowEl    = document.getElementById(`row-${activeRow}`);
  const rowLength = parseInt(rowEl.dataset.length);
  for (let i = 1; i <= rowLength; i++) {
    const nextCol  = (activeCol + i) % rowLength;
    if (nextCol === activeCol) return;
    const nextTile = document.getElementById(`tile-${activeRow}-${nextCol}`);
    if (nextTile && !nextTile.dataset.locked) {
      setActiveTile(activeRow, nextCol);
      return;
    }
  }
}

// ── Find next unsolved row ──
function nextUnsolvedRow(fromRow, direction) {
  const step = direction === 'up' ? -1 : 1;
  for (let i = 1; i <= totalRows; i++) {
    const candidate = (fromRow + step * i + totalRows) % totalRows;
    const rowEl = document.getElementById(`row-${candidate}`);
    if (rowEl && rowEl.dataset.solved !== 'true') return candidate;
  }
  return fromRow;
}

// ── Move active tile ──
function moveActive(direction) {
  const rowEl     = document.getElementById(`row-${activeRow}`);
  const rowLength = parseInt(rowEl.dataset.length);

  if (direction === 'left') {
    setActiveTile(activeRow, (activeCol - 1 + rowLength) % rowLength);
  } else if (direction === 'right') {
    setActiveTile(activeRow, (activeCol + 1) % rowLength);
  } else if (direction === 'up' || direction === 'down') {
    const targetRow   = nextUnsolvedRow(activeRow, direction);
    const targetRowEl = document.getElementById(`row-${targetRow}`);
    const targetLen   = parseInt(targetRowEl.dataset.length);
    setActiveTile(targetRow, Math.min(activeCol, targetLen - 1));
  }
}

// ── Record a guess ──
function recordGuess(r, c, guess) {
  const tile = document.getElementById(`tile-${r}-${c}`);
  if (!tile || tile.dataset.locked) return;

  const thisCipher = tile.dataset.cipher;

  // Record and render the guess on the active tile
  tile.dataset.guess = guess;
  renderTile(tile);

  // Propagate guess to ALL tiles with the same cipher across the whole grid
  document.querySelectorAll(`.tile:not([data-locked])`).forEach(t => {
    if (t.dataset.cipher === thisCipher && t.id !== tile.id) {
      t.dataset.guess = guess;
      renderTile(t);
    }
  });

  // Clear all existing highlights
  document.querySelectorAll('.tile.same-cipher').forEach(t => {
    t.classList.remove('same-cipher');
  });

  // Highlight ALL tiles with the same cipher including the source tile
  document.querySelectorAll(`.tile:not([data-locked])`).forEach(t => {
    if (t.dataset.cipher === thisCipher) {
      t.classList.add('same-cipher');
    }
  });

  updateEnterKey();
}

// ── Global GUESS — checks every uncommitted guess across all rows ──
function commitGuess() {
  let allCorrect     = true;
  let correctCount   = 0;
  let incorrectCount = 0;

  // First pass: collect correct and incorrect ciphers
  const correctCiphers   = new Set();
  const incorrectCiphers = new Set();

  document.querySelectorAll('.row').forEach(rowEl => {
    if (rowEl.dataset.solved === 'true') return;
    rowEl.querySelectorAll('.tile:not([data-locked])').forEach(tile => {
      if (!tile.dataset.guess) return;
      if (tile.dataset.guess === tile.dataset.letter) {
        correctCiphers.add(tile.dataset.cipher);
      } else {
        incorrectCiphers.add(tile.dataset.cipher);
        allCorrect = false;
      }
    });
  });

  // Lock correct ciphers
  correctCiphers.forEach(cipher => {
    const tile = document.querySelector(`.tile[data-cipher="${cipher}"]:not([data-locked])`);
    if (tile && tile.dataset.guess) {
      lockCipher(cipher, tile.dataset.guess);
      correctCount++;
    }
  });

  // Mark ALL tiles with incorrect ciphers red across the whole grid
  // but only count ONE penalty per incorrect cipher, not per tile
  incorrectCiphers.forEach(cipher => {
    document.querySelectorAll(`.tile[data-cipher="${cipher}"]:not([data-locked])`).forEach(tile => {
      tile.classList.add('wrong');
    });
    incorrectCount++;  // one penalty per unique wrong cipher
  });

  if (correctCount  > 0) addScore(-correctCount);
  if (incorrectCount > 0) addScore(incorrectCount * PENALTY);

  pendingRed = true;

  // Check if all rows are now solved
  checkGameOver();
}

// ── Lock all tiles for a cipher ──
function lockCipher(cipher, letter) {
  const affectedRows = new Set();
  document.querySelectorAll('.tile').forEach(t => {
    if (t.dataset.cipher === cipher) {
      t.dataset.locked = true;
      t.dataset.guess  = letter;
      t.classList.remove('wrong', 'active');
      t.classList.add('correct');
      renderTile(t);
      affectedRows.add(parseInt(t.dataset.row));
    }
  });
  affectedRows.forEach(r => checkRowIndirectlySolved(r));
  updateKeyboard();
}

// ── Check if row is indirectly solved ──
function checkRowIndirectlySolved(r) {
  const rowEl = document.getElementById(`row-${r}`);
  if (!rowEl || rowEl.dataset.solved === 'true') return;
  const allLocked = Array.from(rowEl.querySelectorAll('.tile')).every(t => t.dataset.locked);
  if (!allLocked) return;
  rowEl.dataset.solved = 'true';
  checkGameOver();
}

// ── Clear red tiles on next action ──
function clearRedTiles() {
  if (!pendingRed) return;
  document.querySelectorAll('.tile.same-cipher').forEach(t => t.classList.remove('same-cipher'));
  document.querySelectorAll('.tile.wrong').forEach(t => {
    delete t.dataset.guess;
    t.classList.remove('wrong');
    renderTile(t);
  });
  // Clear hints too
  document.querySelectorAll('.tile:not([data-locked])').forEach(t => {
    if (t.dataset.hint) { delete t.dataset.hint; renderTile(t); }
  });
  pendingRed = false;
  updateEnterKey();
}

// ── Row solved ──
function rowSolved(r) {
  const rowEl = document.getElementById(`row-${r}`);
  if (rowEl) rowEl.dataset.solved = 'true';
  checkGameOver();
}

// ── Game over ──
function checkGameOver() {
  const allSolved = Array.from(document.querySelectorAll('.row'))
    .every(row => row.dataset.solved === 'true');
  if (!allSolved) return;
  gameOver = true;
  clearInterval(scoreTimer);

  const scoreEl = document.getElementById('score');
  scoreEl.classList.add('final');
  scoreEl.innerHTML = `Final Score: <span id="score-value" class="final-value">${score}</span>`;

  // Reveal title and author if provided
  if (titleReveal || puzzleAuthor) {
    const revealEl = document.getElementById('game-subtitle');
    let revealText = '';
    if (titleReveal) revealText += titleReveal;
    if (puzzleAuthor) revealText += (titleReveal ? ' — ' : '') + puzzleAuthor;
    revealEl.textContent = revealText;
    revealEl.style.display = 'block';
    revealEl.classList.add('revealed');
  }
}

// ── Clear a single tile ──
function clearTile(tile) {
  if (tile.dataset.locked) return;
  delete tile.dataset.guess;
  delete tile.dataset.hint;
  tile.classList.remove('wrong');
  renderTile(tile);
}

// ── Clear guess at active position ──
// Clears ALL tiles sharing the same cipher, not just the active one
function clearGuess(r, c) {
  document.querySelectorAll('.tile.same-cipher').forEach(t => t.classList.remove('same-cipher'));
  const tile = document.getElementById(`tile-${r}-${c}`);
  if (!tile || tile.dataset.locked) return;
  const thisCipher = tile.dataset.cipher;
  // Clear every unlocked tile sharing this cipher across the whole grid
  document.querySelectorAll(`.tile[data-cipher="${thisCipher}"]:not([data-locked])`).forEach(t => {
    delete t.dataset.guess;
    delete t.dataset.hint;
    t.classList.remove('wrong', 'same-cipher');
    renderTile(t);
  });
  updateEnterKey();
}

// ── Fit grid to screen ──
// Scales tile size so the widest row fits within the viewport width,
// also accounting for the keyboard and header height.
function fitGridToScreen() {
  const MIN_TILE  = 28;   // px — minimum tile size before scroll kicks in
  const MAX_TILE  = 52;   // px — default tile size
  const GAP       = 6;    // px — gap between tiles (matches CSS)
  const SPACE_W   = 16;   // px — word space width (matches CSS)
  const PUNCT_W   = 10;   // px — punctuation marker width (matches CSS)
  const BTN_W     = 100;  // px — GUESS button width + gap
  const PADDING   = 80;   // px — page left+right padding

  const availableWidth = window.innerWidth - PADDING - BTN_W;

  // Find the widest row by measuring each child element type
  let maxTilesInRow = 0;
  let maxNonTileWidth = 0;

  document.querySelectorAll('.row-wrap').forEach(wrap => {
    const row = wrap.querySelector('.row');
    if (!row) return;
    let tileCount = 0;
    let nonTileWidth = 0;
    row.childNodes.forEach(child => {
      if (child.classList && child.classList.contains('tile')) {
        tileCount++;
        nonTileWidth += GAP;  // gap after each tile
      } else if (child.classList && child.classList.contains('word-space')) {
        nonTileWidth += SPACE_W;
      } else if (child.classList && child.classList.contains('punct-marker')) {
        nonTileWidth += PUNCT_W;
      }
    });
    if (tileCount > maxTilesInRow ||
       (tileCount === maxTilesInRow && nonTileWidth > maxNonTileWidth)) {
      maxTilesInRow = tileCount;
      maxNonTileWidth = nonTileWidth;
    }
  });

  if (maxTilesInRow === 0) return;

  // ── Width constraint ──
  // tileSize = (availableWidth - nonTileWidth) / tileCount
  let tileSizeByWidth = Math.floor((availableWidth - maxNonTileWidth) / maxTilesInRow);

  // ── Height constraint ──
  // Available height = window height - header - keyboard - grid gaps - padding
  const header      = document.querySelector('header');
  const keyboard    = document.getElementById('keyboard');
  const headerH     = header   ? header.offsetHeight   : 80;
  const keyboardH   = keyboard ? keyboard.offsetHeight : 180;
  const ROW_GAP     = 6;
  const V_PADDING   = 48;
  const availableHeight = window.innerHeight - headerH - keyboardH - V_PADDING;
  const rowCount    = document.querySelectorAll('.row').length;
  // Each row is a square tile plus gap
  let tileSizeByHeight = rowCount > 0
    ? Math.floor((availableHeight - rowCount * ROW_GAP) / rowCount)
    : MAX_TILE;

  // Use the smaller of width and height constraints
  let tileSize = Math.min(tileSizeByWidth, tileSizeByHeight);
  tileSize = Math.max(MIN_TILE, Math.min(MAX_TILE, tileSize));

  // Apply as CSS variables — font sizes scale with tile
  document.documentElement.style.setProperty('--tile-size', `${tileSize}px`);
  document.documentElement.style.setProperty('--tile-font', `${Math.max(9, Math.floor(tileSize * 0.45))}px`);
  document.documentElement.style.setProperty('--cipher-font', `${Math.max(8, Math.floor(tileSize * 0.38))}px`);
}

// Re-fit on window resize
window.addEventListener('resize', fitGridToScreen);

// ── Reset — clear all uncommitted guesses across the whole grid ──
function resetGuesses() {
  document.querySelectorAll('.tile:not([data-locked])').forEach(t => {
    delete t.dataset.guess;
    t.classList.remove('wrong', 'same-cipher');
    renderTile(t);
  });
  // Reset guess buttons
  for (let r = 0; r < totalRows; r++) {
    const btn = document.getElementById(`btn-${r}`);
    if (btn) btn.disabled = false;
  }
  updateEnterKey();
}

// ── Toggle between daily and random mode ──
function toggleMode() {
  const isRandom = wordListFile === 'wordlist.txt';
  if (isRandom) {
    window.location.href = 'index.html';  // back to daily.txt default
  } else {
    window.location.href = 'index.html?list=wordlist.txt';
  }
}

// ── Pause / resume ──
function togglePause() {
  paused = !paused;
  const btn = document.getElementById('pause-btn');
  btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  document.getElementById('grid').classList.toggle('paused', paused);
}

// ── About modal ──
function toggleAbout() {
  const overlay   = document.getElementById('about-overlay');
  const isVisible = overlay.style.display === 'flex';
  overlay.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible && !paused) togglePause();
  else if (isVisible && paused) togglePause();
}
