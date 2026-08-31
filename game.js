// Copyright (c) 2025 Pehr Jansson. All rights reserved.
// Unauthorized use, copying, or distribution is strictly prohibited.
// XRDICA v0.0.37

// ── Game state ──
let WORD_LIST     = [];
let LETTER_MAP    = {};
let VALID_CHARS   = new Set();
let GAME_MODE     = 'random';
let INITIAL_ROWS  = 4;
let MAX_ROWS      = 10;
let NEW_ROW_EVERY = 50;
let RANDOM_SEQUENCE = []; // precomputed, deterministic word order for random mode

let totalRows  = 0;
let activeRow  = 0;
let activeCol  = 0;
let pendingRed = false;
let gameOver   = false;
let paused     = false;
let score      = 0;
let timeScore  = 0;   // portion of score from the +1/5s timer
let guessScore = 0;   // portion of score from keystrokes and GUESS penalties
let lastRowAddedAtScore = 0;
let PENALTY = 2;
let MIN_WORD_LENGTH = 5;
let MAX_WORD_LENGTH = 10;
let STATIC_LINES = [];   // all lines from file in order
let STATIC_NEXT = 0;     // index of next line to reveal
let STATIC_MAX = 12;     // max lines to show
const usedWords = new Set();

let scoreTimer   = null;
let titleReveal  = null;
let puzzleAuthor = null;
let PUZZLE_LABEL = null; // date or "Puzzle #N" text — reused by the share button

// ── Parse and format a date string into international format ──
// Accepts: mmddyyyy, mm/dd/yyyy, yyyy-mm-dd, "10 August 2026", etc.
function formatPuzzleDate(str) {
  if (!str) return null;
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  str = str.trim();

  // Try mmddyyyy (8 digits)
  if (/^\d{8}$/.test(str)) {
    const m = parseInt(str.slice(0,2)) - 1;
    const d = parseInt(str.slice(2,4));
    const y = parseInt(str.slice(4,8));
    if (m >= 0 && m < 12) return `${d} ${months[m]} ${y}`;
  }

  // Try yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return `${d} ${months[m-1]} ${y}`;
  }

  // Try mm/dd/yyyy or mm-dd-yyyy
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) {
    const parts = str.split(/[\/\-]/).map(Number);
    return `${parts[1]} ${months[parts[0]-1]} ${parts[2]}`;
  }

  // Try to parse as a natural date string
  const d = new Date(str);
  if (!isNaN(d)) {
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Return as-is if we can't parse it
  return str;
}

// ── Subtitle text for a puzzle seed ──
// A date-based seed (from the daily rotation or an archive-calendar link
// to a date with no curated file) is always > MAX_PUBLIC_SEED — see the
// "date as seed" comment in loadWithFallback(). Those should show the
// actual date, not a puzzle number. An Easy Random seed lives in its own
// offset range (see EASY_SEED_OFFSET below) and shows "EASY RANDOM —
// Puzzle #N" using the un-offset display number. Only a genuinely
// player-chosen random seed (Random button / Enter Puzzle Number) shows
// plain "Puzzle #N".
function seedSubtitle(seed) {
  if (seed > EASY_SEED_OFFSET && seed <= EASY_SEED_OFFSET + MAX_PUBLIC_SEED) {
    return `EASY RANDOM — Puzzle #${seed - EASY_SEED_OFFSET}`;
  }
  if (seed > MAX_PUBLIC_SEED) {
    const s = String(seed); // YYYYMMDD
    return formatPuzzleDate(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
  }
  return `Puzzle #${seed}`;
}

// ── Bootstrap ──
const urlParams    = new URLSearchParams(window.location.search);
const MAX_PUBLIC_SEED = 99999;
// Easy Random puzzles reuse the exact same wordlist.txt + seed machinery
// as normal random puzzles, but their seed is offset into its own range
// so it can never collide with a normal random seed (1-99999) OR a
// date-based seed (8-digit, 20000000+) — the seed's numeric range alone
// is what tells the game "this is an easy puzzle" once the URL is
// loaded, no separate flag parameter needed. The player only ever sees/
// types the small, friendly 1-99999 display number; this offset is
// added/removed behind the scenes.
const EASY_SEED_OFFSET = 100000;
const EASY_MIN_PRESOLVED_TILES = 10; // pre-solve letters until at least this many tiles are locked

// ── Today's date, using the player's local time zone ──
// (Deliberately local, not UTC — a puzzle shouldn't roll over to "tomorrow"
// while it's still today where the player is.)
function localDateDashed(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const TODAY_DATE_DASHED = localDateDashed();               // YYYY-MM-DD, local
const TODAY_DATE        = TODAY_DATE_DASHED.replace(/-/g, ''); // YYYYMMDD
const TODAY_DATE_INT    = parseInt(TODAY_DATE);  // e.g. 20260814 — used as date seed

// ── Determine word list file ──
// If ?list= is specified use that, otherwise try today's daily file.
// All daily puzzles — past, today, and any staged ahead of time — live
// in the daily/ folder, named by date: daily/YYYY-MM-DD.txt.
const listParam    = urlParams.get('list');
const DAILY_FILE   = `daily/${TODAY_DATE_DASHED}.txt`; // e.g. daily/2026-08-17.txt
const wordListFile = listParam || DAILY_FILE;
const IS_DAILY     = !listParam;
const IS_RANDOM    = listParam === 'wordlist.txt';

// ── Puzzle date for display ──
// Never sourced from a #date meta line (deprecated/ignored) — the date
// is always derived from the file itself, which already matches
// daily/YYYY-MM-DD.txt for both today's live daily and any archived
// date. Non-daily puzzle files (e.g. ?list=mystery1.txt) have no
// associated date and simply show no date subtitle.
const dailyDateMatch = wordListFile.match(/^daily\/(\d{4}-\d{2}-\d{2})\.txt$/);
const PUZZLE_DATE_DASHED = dailyDateMatch ? dailyDateMatch[1] : null;

// ── Determine seed ──
// A puzzle's seed drives its cipher shuffle (and, for random-mode
// puzzles, its word selection) — so the SAME seed must always produce
// the SAME puzzle for every player. Priority:
//   1. Explicit ?seed= in the URL — lets a specific random puzzle be
//      shared or replayed exactly
//   2. IS_RANDOM with no seed yet ("New Random Game") — genuinely
//      random on click, then written into the URL so it's reproducible
//      from that point on
//   3. A dated puzzle (today's daily or an archived date) — seeded from
//      its date, so every player sees the identical cipher for that day
//   4. Any other specific file (e.g. ?list=mystery1.txt) — seeded from
//      a hash of its filename, so the same file always shuffles the
//      same way too
let PUZZLE_SEED = null;
const seedParam = urlParams.get('seed');
if (seedParam) {
  PUZZLE_SEED = parseInt(seedParam);
} else if (IS_RANDOM) {
  // Random mode — generate a public seed
  PUZZLE_SEED = Math.floor(Math.random() * MAX_PUBLIC_SEED) + 1;
  const newUrl = new URL(window.location.href);
  newUrl.searchParams.set('seed', PUZZLE_SEED);
  window.history.replaceState({}, '', newUrl);
} else if (PUZZLE_DATE_DASHED) {
  // Dated puzzle — same cipher for every player, every day
  PUZZLE_SEED = parseInt(PUZZLE_DATE_DASHED.replace(/-/g, ''));
} else {
  // Any other specific file — deterministic from its name
  PUZZLE_SEED = hashStringToSeed(wordListFile);
}

// Initialise seeded RNG — every puzzle now has a seed, so this always runs
setRng(PUZZLE_SEED);

// Easy Random detection — see EASY_SEED_OFFSET comment above. Requires
// IS_RANDOM too, purely as a defensive guard: an easy-range seed could
// otherwise only ever occur on a wordlist.txt URL in practice, but this
// keeps a hash-based seed for some other file from ever being
// misinterpreted as easy mode by coincidence.
const IS_EASY_RANDOM = IS_RANDOM && PUZZLE_SEED > EASY_SEED_OFFSET && PUZZLE_SEED <= EASY_SEED_OFFSET + MAX_PUBLIC_SEED;

// ── Saved-progress key ──
// Unique per puzzle (file + seed when applicable) so reloading the exact
// same puzzle restores it, but a different date/seed/file never collides
// with another puzzle's saved progress.
const PROGRESS_KEY = 'xrdica-progress:' + wordListFile + (PUZZLE_SEED !== null ? ':' + PUZZLE_SEED : '');

// ── Load word list — with fallback for missing daily ──
async function loadWithFallback() {
  if (IS_DAILY) {
    try {
      // Try today's curated daily file first
      const res = await fetch(DAILY_FILE);
      if (res.ok) {
        const text = await res.text();
        return parseWordListText(text);
      }
    } catch(e) {}
    // Fallback: no curated file for today — auto-generate a puzzle from
    // wordlist.txt. Seed is already set (see "Determine seed" above,
    // branch 3) from today's date, so this is identical for every
    // player regardless of whether a curated file existed.
    return await loadWordList('wordlist.txt');
  } else {
    return await loadWordList(wordListFile);
  }
}

// ── Easy Random: pre-solve a handful of letters as a head start ──
// Deterministic — draws from the same seeded RNG already used for word
// selection, so two players on the same easy seed see identical
// pre-solved tiles. Doesn't touch score at all; it's exactly as if the
// game simply started this way. Deliberately uniform random over the
// letters actually present (not weighted toward common ones) — rare
// letters are just as likely to get picked, per Pehr's design.
function preSolveEasyTiles() {
  const tiles = Array.from(document.querySelectorAll('.tile'));
  const lettersPresent = shuffle(Array.from(new Set(tiles.map(t => t.dataset.letter))));

  let solvedCount = 0;
  for (const letter of lettersPresent) {
    if (solvedCount >= EASY_MIN_PRESOLVED_TILES) break;
    const matchingTiles = tiles.filter(t => t.dataset.letter === letter && !t.dataset.locked);
    if (matchingTiles.length === 0) continue;
    matchingTiles.forEach(t => {
      t.dataset.locked = true;
      t.dataset.guess  = letter;
      t.classList.add('correct');
      renderTile(t);
    });
    solvedCount += matchingTiles.length;
  }

  // A row could end up fully solved purely from this step — addRow()'s
  // own checkRowIndirectlySolved() call already ran before pre-solving
  // happened, so it couldn't have caught that; re-check every row now.
  document.querySelectorAll('.row').forEach(rowEl => {
    checkRowIndirectlySolved(parseInt(rowEl.id.replace('row-', '')));
  });

  updateKeyboard();
  updateEnterKey();
}

loadWithFallback().then(({ meta, words, cipherAlphabet, validChars }) => {
  WORD_LIST   = words;
  VALID_CHARS = validChars;
  GAME_MODE   = meta.mode;
  LETTER_MAP  = buildLetterMap(cipherAlphabet, meta.cipher || null);

  PENALTY = meta.penalty ?? 2;
  MIN_WORD_LENGTH = meta.minLength || 5;
  MAX_WORD_LENGTH = meta.maxLength || 10;

  if (meta.mode === 'random') {
    INITIAL_ROWS  = meta.rows; // loader.js guarantees this is >= MIN_INITIAL_ROWS (4)
    MAX_ROWS      = meta.maxRows;
    NEW_ROW_EVERY = meta.interval;
    // Decide the entire word sequence up front — deterministic from the
    // seed alone, so every player on this puzzle sees the same rows in
    // the same order regardless of solving pace.
    RANDOM_SEQUENCE = precomputeWordSequence(
      WORD_LIST, LETTER_MAP, VALID_CHARS, MIN_WORD_LENGTH, MAX_WORD_LENGTH, MAX_ROWS, 3
    );
  }

  // Store reveal info for game over
  titleReveal  = meta.titleReveal || null;
  puzzleAuthor = meta.author || null;

  // Title: use today's date (static mode) or provided title (random mode)

  if (meta.mode === 'static') {
    document.getElementById('game-title').textContent = 'XRDICA';
    document.title = 'XRDICA';
    if (PUZZLE_DATE_DASHED) {
      PUZZLE_LABEL = formatPuzzleDate(PUZZLE_DATE_DASHED);
      document.getElementById('game-subtitle').textContent = PUZZLE_LABEL;
      document.getElementById('game-subtitle').style.display = 'block';
    }
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

  // Note above the grid when this puzzle hides spaces as a solvable token
  const spaceNoteEl = document.getElementById('space-note');
  if (spaceNoteEl) {
    if (VALID_CHARS.has(' ')) {
      spaceNoteEl.textContent = 'This puzzle hides spaces too — solving "ICE CREAM" means cracking the code between the words as well. Tap spacebar to guess a space.';
      spaceNoteEl.style.display = 'block';
    } else {
      spaceNoteEl.style.display = 'none';
    }
  }

  buildKeyboard(cipherAlphabet);

  if (meta.mode === 'static') {
    STATIC_LINES = words;
    STATIC_MAX   = meta.maxLines || 12;
    // loader.js guarantees meta.startLines is always >= MIN_INITIAL_ROWS (4)
    STATIC_NEXT  = meta.startLines;
    // Add only the initial lines (clamped to however many words actually exist)
    const startCount = Math.min(meta.startLines, words.length);
    for (let r = 0; r < startCount; r++) addRow(r, words[r]);
  } else {
    for (let r = 0; r < INITIAL_ROWS; r++) addRow(r);
    if (IS_EASY_RANDOM) preSolveEasyTiles();
  }

  // Restore any saved progress for this exact puzzle (prevents reloading
  // the page from resetting score) — adds any extra rows already reached
  // and re-applies guesses/locks on top of the rows just built above.
  restoreProgress(loadProgress());

  scoreTimer = setInterval(() => addScore(1, 'time'), 5000);
  fitGridToScreen();
  // Update random button label based on current mode
  const randomBtn = document.getElementById('random-btn');
  const isRandom = IS_RANDOM;
  if (randomBtn) {
    randomBtn.textContent = isRandom ? "Today's Puzzle" : 'Random';
    if (isRandom) randomBtn.onclick = () => window.location.href = 'index.html';
  }

  // A specific non-daily, non-random file (an archived date, or any
  // other standalone puzzle file) leaves no direct way back to today's
  // daily other than the Archive modal or the title — show an explicit
  // Daily button in the bar for that case.
  const dailyBtn = document.getElementById('daily-btn');
  if (dailyBtn) dailyBtn.style.display = (!IS_DAILY && !IS_RANDOM) ? 'inline-block' : 'none';

  // Show puzzle number/date in subtitle during random play
  if (IS_RANDOM && PUZZLE_SEED !== null) {
    const subtitleEl = document.getElementById('game-subtitle');
    PUZZLE_LABEL = seedSubtitle(PUZZLE_SEED);
    subtitleEl.textContent = PUZZLE_LABEL;
    subtitleEl.style.display = 'block';
  } else if (IS_DAILY && meta.mode !== 'static') {
    // Auto-generated daily fallback — show date
    const subtitleEl = document.getElementById('game-subtitle');
    PUZZLE_LABEL = formatPuzzleDate(PUZZLE_DATE_DASHED);
    subtitleEl.textContent = PUZZLE_LABEL;
    subtitleEl.style.display = 'block';
  }

  setActiveTile(0, 0);

}).catch(err => {
  console.error('Failed to load word list:', err);
  console.error('Word list file attempted:', wordListFile);
  // Show auto-generated fallback message
  document.getElementById('grid').textContent = 'Error loading puzzle. Please try again.';
  document.getElementById('grid').textContent = `Error loading word list: ${err.message}`;
});

// ── Save / restore progress (localStorage) ──
// Prevents reloading the page from resetting score/progress. This
// guards against casual "reload to reset my score" cheating and also
// against replaying an already-finished puzzle for a better score —
// but it's still client-side storage, so it's not tamper-proof against
// someone deliberately editing localStorage by hand.
function saveProgress() {
  if (typeof localStorage === 'undefined') return;
  try {
    const rows = Array.from(document.querySelectorAll('.row')).map(rowEl => ({
      solved: rowEl.dataset.solved === 'true',
      tiles: Array.from(rowEl.querySelectorAll('.tile')).map(t => ({
        guess:  t.dataset.guess || null,
        locked: !!t.dataset.locked
      }))
    }));
    const state = { score, timeScore, guessScore, totalRows, gameOver, rows };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
  } catch (e) { /* storage unavailable or full — progress just won't persist */ }
}

function loadProgress() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function restoreProgress(saved) {
  if (!saved) return;

  // Reveal any additional rows the player had already reached, using
  // the same deterministic word source (RANDOM_SEQUENCE or STATIC_LINES)
  // — never re-picks anything, just replays the same reveal steps.
  while (totalRows < saved.totalRows) {
    if (GAME_MODE === 'static') {
      if (STATIC_NEXT >= STATIC_LINES.length) break;
      addRow(totalRows, STATIC_LINES[STATIC_NEXT]);
      STATIC_NEXT++;
    } else {
      const before = totalRows;
      addRow(totalRows);
      if (totalRows === before) break; // sequence exhausted, can't add more
    }
  }

  const rowEls = document.querySelectorAll('.row');
  // Sanity check: if the puzzle content changed since this was saved
  // (row/tile counts don't line up), discard rather than risk a
  // mismatched, confusing restore.
  if (rowEls.length < saved.rows.length) return;
  for (let r = 0; r < saved.rows.length; r++) {
    const tileEls = rowEls[r].querySelectorAll('.tile');
    if (tileEls.length !== saved.rows[r].tiles.length) return;
  }

  score      = saved.score;
  timeScore  = saved.timeScore;
  guessScore = saved.guessScore;
  document.getElementById('score-value').textContent = score;
  lastRowAddedAtScore = score; // don't immediately re-trigger a new row

  saved.rows.forEach((savedRow, r) => {
    const tileEls = rowEls[r].querySelectorAll('.tile');
    savedRow.tiles.forEach((savedTile, c) => {
      const tile = tileEls[c];
      if (savedTile.guess) tile.dataset.guess = savedTile.guess;
      if (savedTile.locked) {
        tile.dataset.locked = true;
        tile.classList.add('correct'); // drives the green styling — dataset.locked alone doesn't
      }
      renderTile(tile);
    });
    if (savedRow.solved) rowEls[r].dataset.solved = 'true';
  });

  updateKeyboard();
  updateEnterKey();
  updateClearButton();

  if (saved.gameOver) checkGameOver();
}

// ── Scoring ──
// category: 'time' for the passive +1/5s ticks, 'guess' for anything
// driven by player action (keystrokes, GUESS correct/incorrect penalties)
function addScore(points, category = 'guess') {
  if (gameOver || paused) return;
  score += points;
  if (category === 'time') timeScore += points;
  else guessScore += points;
  document.getElementById('score-value').textContent = score;

  if (score - lastRowAddedAtScore >= NEW_ROW_EVERY) {
    if (GAME_MODE === 'random' && totalRows < MAX_ROWS) {
      lastRowAddedAtScore = score;
      addRowAndSkipPresolved();
    } else if (GAME_MODE === 'static' && STATIC_NEXT < STATIC_LINES.length && totalRows < STATIC_MAX) {
      lastRowAddedAtScore = score;
      addRowAndSkipPresolved();
    }
  }
  saveProgress();
}

// ── Add a new row, skipping ahead if it's already fully solved ──
// A newly revealed row can end up with every tile auto-locked from
// ciphers the player already solved elsewhere in the grid — giving them
// nothing new to actually do. When that happens, immediately reveal the
// next row too (and so on) until either a row has real unsolved content,
// or there's nothing left to reveal (max rows / word list exhausted).
function addRowAndSkipPresolved() {
  while (!gameOver) {
    if (GAME_MODE === 'random') {
      if (totalRows >= MAX_ROWS) break;
      const before = totalRows;
      addRow(totalRows);
      if (totalRows === before) break; // sequence exhausted
    } else { // static
      if (STATIC_NEXT >= STATIC_LINES.length || totalRows >= STATIC_MAX) break;
      addRow(totalRows, STATIC_LINES[STATIC_NEXT]);
      STATIC_NEXT++;
    }
    const justAdded = document.getElementById(`row-${totalRows - 1}`);
    if (!justAdded || justAdded.dataset.solved !== 'true') break; // real content — stop here
    // else: this row came in fully pre-solved — loop again for the next one
  }
}

// ── Parse a poem line into segments ──
// A character is a cipher token if it appears in VALID_CHARS (the alphabet).
// Normally a space is just a gap between words — but if this puzzle's
// alphabet includes space as a token (see #alphabet in loader.js), a
// space becomes a solvable tile just like any letter. Everything else
// that isn't a cipher token is punctuation displayed between tiles.
function parseLine(line) {
  const segments = [];
  for (const ch of line) {
    const lower = ch.toLowerCase();
    if (ch === ' ' && !VALID_CHARS.has(' ')) {
      segments.push({ type: 'space' });
    } else if (VALID_CHARS.has(lower) || (ACCENT_MAP[lower] && VALID_CHARS.has(ACCENT_MAP[lower]))) {
      segments.push({ type: 'letter', ch: lower });
    } else {
      segments.push({ type: 'punct', ch });
    }
  }
  return segments;
}

// ── Visible glyph for a guess/display character ──
// A literal space is invisible in a tile, so show an open-box glyph for
// it instead; everything else displays as its uppercase character.
const SPACE_GLYPH = '␣';
function displayChar(ch) {
  return ch === ' ' ? SPACE_GLYPH : ch.toUpperCase();
}

// ── Add a row to the grid ──
function addRow(r, forcedWord) {
  let word;
  if (forcedWord !== undefined) {
    word = forcedWord;
    usedWords.add(word);
  } else {
    // Random mode: word order was decided up front (deterministic from
    // the seed) — just look it up, never pick live.
    word = RANDOM_SEQUENCE[r];
    if (!word) return;
    usedWords.add(word);
  }

  const rowWrap = document.createElement('div');
  rowWrap.classList.add('row-wrap');
  rowWrap.id = `wrap-${r}`;

  const row = document.createElement('div');
  row.classList.add('row');
  row.id = `row-${r}`;
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
      if (ch === ' ') tile.classList.add('space-tile'); // lighter green when solved, so the blank is visible
      tile.id = `tile-${r}-${c}`;
      tile.dataset.letter  = token || ch;   // base letter for cipher matching
      tile.dataset.display = displayChar(ch); // original char for display (may have accent, or space glyph)
      tile.dataset.cipher  = cipher;
      tile.dataset.row     = r;
      tile.dataset.col     = c;

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
  updateMaxRowsNote();
}

// ── Show/hide the "all rows revealed" note ──
// Lets the player know when they've hit the row ceiling (MAX_ROWS in
// random mode, or the word list/#max-lines running out in static mode)
// so a score increase with no new row appearing reads as expected
// behavior, not a bug.
function updateMaxRowsNote() {
  const noteEl = document.getElementById('max-rows-note');
  if (!noteEl) return;
  let atCap;
  if (GAME_MODE === 'random') {
    atCap = totalRows >= MAX_ROWS;
  } else {
    atCap = totalRows >= STATIC_MAX || STATIC_NEXT >= STATIC_LINES.length;
  }
  noteEl.style.display = (atCap && !gameOver) ? 'block' : 'none';
}

// ── Render a tile ──
function renderTile(tile) {
  tile.innerHTML = '';

  if (tile.dataset.guess) {
    const letterEl = document.createElement('span');
    letterEl.classList.add('letter');
    // Show original accented character when locked, base letter when guessing
    if (tile.dataset.locked && tile.dataset.display) {
      letterEl.textContent = tile.dataset.display;
    } else {
      letterEl.textContent = displayChar(tile.dataset.guess);
    }
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
    hintEl.textContent = displayChar(tile.dataset.hint);
    tile.appendChild(hintEl);
  }
}

// ── Render a same-cipher tile — shows guessed letter above cipher, orange tinted ──
function renderSameCipherTile(tile, guess) {
  tile.innerHTML = '';

  const letterEl = document.createElement('span');
  letterEl.classList.add('letter');
  letterEl.textContent = displayChar(guess);
  tile.appendChild(letterEl);

  const cipherEl = document.createElement('span');
  cipherEl.classList.add('cipher');
  cipherEl.textContent = tile.dataset.cipher;
  tile.appendChild(cipherEl);
}

// ── Show/hide clear button based on uncommitted guesses ──
function updateClearButton() {
  const btn = document.getElementById('clear-btn');
  if (!btn) return;
  const hasGuesses = Array.from(document.querySelectorAll('.tile:not([data-locked])')).some(t => t.dataset.guess);
  btn.style.display = hasGuesses ? 'flex' : 'none';
}

// ── Build on-screen keyboard ──
function buildKeyboard(alphabet) {
  const keyboard = document.getElementById('keyboard');
  keyboard.innerHTML = '';

  const qwertyRows = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⌫','z','x','c','v','b','n','m','Enter','Clear']
  ];

  const alphabetSet    = new Set(alphabet);
  const coveredByQwerty = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
  // Space (when present) gets its own dedicated row below, so it's
  // excluded here from the "extra letters" squeezed into the bottom row
  // (that treatment is for things like å ä ö).
  const extraLetters   = alphabet.filter(ch => ch !== ' ' && !coveredByQwerty.has(ch));

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
      if (k === 'Clear') {
        btn.id = 'clear-btn';
        btn.style.display = 'none';
        btn.addEventListener('click', () => resetGuesses());
      } else {
        btn.addEventListener('click', () => handleKeyInput(k));
      }
      rowEl.appendChild(btn);
    });

    keyboard.appendChild(rowEl);
  });

  // Dedicated spacebar row — only shown when this puzzle's alphabet
  // includes space as a cipher token (see #alphabet in loader.js).
  if (alphabetSet.has(' ')) {
    const spaceRow = document.createElement('div');
    spaceRow.classList.add('kb-row', 'kb-row-space');

    const spaceBtn = document.createElement('button');
    spaceBtn.classList.add('key', 'key-space');
    spaceBtn.textContent = 'SPACE';
    spaceBtn.dataset.key = ' ';
    spaceBtn.addEventListener('click', () => handleKeyInput(' '));

    spaceRow.appendChild(spaceBtn);
    keyboard.appendChild(spaceRow);
  }
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

  // Spacebar enters a space guess when this puzzle's alphabet includes
  // space as a cipher token; otherwise it behaves as delete (legacy).
  const spaceIsToken = k === ' ' && LETTER_MAP[' '] !== undefined;

  if (!spaceIsToken && (k === '⌫' || k === 'Backspace' || k === 'Delete' || k === ' ')) {
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
// explicit=true shows same-cipher highlights — used for every real
// navigation (click, typing-advance, arrow keys). Only the very first
// tile on page load skips this (nothing meaningful to highlight yet).
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
      setActiveTile(activeRow, nextCol, true);
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
    setActiveTile(activeRow, (activeCol - 1 + rowLength) % rowLength, true);
  } else if (direction === 'right') {
    setActiveTile(activeRow, (activeCol + 1) % rowLength, true);
  } else if (direction === 'up' || direction === 'down') {
    const targetRow   = nextUnsolvedRow(activeRow, direction);
    const targetRowEl = document.getElementById(`row-${targetRow}`);
    const targetLen   = parseInt(targetRowEl.dataset.length);
    setActiveTile(targetRow, Math.min(activeCol, targetLen - 1), true);
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
  updateClearButton();
  saveProgress();
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
  updateMaxRowsNote(); // hide the "all rows revealed" note — final score is showing now

  const scoreEl = document.getElementById('score');
  scoreEl.classList.add('final');
  let finalHtml = `Final Score: <span id="score-value" class="final-value">${score}</span>` +
    `<span class="score-breakdown"> (${timeScore} time based and ${guessScore} guess based)</span>` +
    `<span class="rows-used"> · Solved in ${totalRows} row${totalRows === 1 ? '' : 's'}</span>`;
  if (IS_RANDOM && PUZZLE_SEED !== null) {
    finalHtml += `<span class="puzzle-number"> · ${seedSubtitle(PUZZLE_SEED)}</span>`;
  }
  scoreEl.innerHTML = finalHtml;

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.style.display = 'inline-block';

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

  saveProgress();
}

// ── Share result (copies a short shareable summary to the clipboard) ──
function shareResult() {
  const label = PUZZLE_LABEL || 'XRDICA';
  const maxRows = GAME_MODE === 'random' ? MAX_ROWS : STATIC_MAX;
  const filled = Math.min(totalRows, maxRows);
  const empty = Math.max(maxRows - filled, 0);
  // Array.from (not .split('')) — these square emoji are outside the BMP
  // (surrogate pairs in UTF-16), so a plain split would corrupt them.
  const tileBar = Array.from(
    '🟩'.repeat(filled) + '⬜'.repeat(empty)
  ).join('\u2009'); // thin space between tiles — a full space reads too wide
  const text = `XRDICA — ${label}\n${tileBar}\nScore ${score}\nxrdica.com`;

  const btn = document.getElementById('share-btn');
  const originalText = btn ? btn.textContent : null;
  const flash = (msg) => {
    if (!btn) return;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = originalText; }, 1500);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => flash('Copied!'))
      .catch(() => flash('Copy failed'));
  } else {
    flash('Copy failed');
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
  saveProgress();
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

  // Match the header's width to the widest row's actual rendered width,
  // so it visually centers over the grid's content instead of an
  // unrelated fixed-width box. Bounded below by MIN_HEADER_WIDTH (so the
  // header's own buttons always have room and don't wrap) and above by
  // the actual viewport width (so an extremely long puzzle line can't
  // push the header wider than the page itself).
  const MIN_HEADER_WIDTH = 480; // px
  if (header) {
    const widestRowWidth = maxTilesInRow * tileSize + maxNonTileWidth;
    const maxHeaderWidth = window.innerWidth - PADDING;
    const boundedWidth = Math.min(Math.max(widestRowWidth, MIN_HEADER_WIDTH), maxHeaderWidth);
    header.style.width = `${boundedWidth}px`;
  }

  // Cap the grid's own height to what's actually available and let it
  // scroll internally past that point — MIN_TILE is a hard floor, so
  // with enough rows (e.g. the full 10-row max) even minimum-size tiles
  // can genuinely not fit on a shorter screen. Without this, the grid
  // just grows past its space and pushes the keyboard off the bottom of
  // the page with no way to scroll to it.
  const grid = document.getElementById('grid');
  if (grid) grid.style.maxHeight = `${Math.max(availableHeight, tileSize + ROW_GAP)}px`; // floor: always room for at least one row
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
  updateClearButton();
  saveProgress();
}

// ── Random modal ──
function toggleRandomModal() {
  const overlay = document.getElementById('random-overlay');
  overlay.style.display = 'flex';
  if (!paused) togglePause();
}

function closeRandomModal() {
  document.getElementById('random-overlay').style.display = 'none';
  if (paused) togglePause();
}

function startRandomGame() {
  const seed = Math.floor(Math.random() * MAX_PUBLIC_SEED) + 1;
  window.location.href = `index.html?list=wordlist.txt&seed=${seed}`;
}

// ── Easy Random: fresh random seed, offset into the easy range ──
function startEasyRandomGame() {
  const displaySeed = Math.floor(Math.random() * MAX_PUBLIC_SEED) + 1;
  window.location.href = `index.html?list=wordlist.txt&seed=${displaySeed + EASY_SEED_OFFSET}`;
}

let pendingEasySeed = false; // set before opening the puzzle-number modal so confirmPuzzleNumber() knows whether to add the easy offset

function showPuzzleNumberInput() {
  pendingEasySeed = false;
  document.getElementById('puzzle-modal-title').textContent = 'Enter Puzzle Number';
  document.getElementById('puzzle-modal-desc').textContent = 'Type a number between 1 and 99999 to play a specific puzzle.';
  closeRandomModal();
  promptPuzzleNumber();
}

// ── Easy Random: same input flow, but the entered number is offset
// into the easy range before navigating ──
function showEasyPuzzleNumberInput() {
  pendingEasySeed = true;
  document.getElementById('puzzle-modal-title').textContent = 'Enter Easy Puzzle Number';
  document.getElementById('puzzle-modal-desc').textContent = 'Type a number between 1 and 99999 to play a specific easy puzzle.';
  closeRandomModal();
  promptPuzzleNumber();
}

// ── Puzzle number modal ──
function promptPuzzleNumber() {
  const overlay = document.getElementById('puzzle-overlay');
  const input   = document.getElementById('puzzle-input');
  overlay.style.display = 'flex';
  input.value = '';
  setTimeout(() => input.focus(), 50);
  if (!paused) togglePause();
}

function closePuzzleModal() {
  document.getElementById('puzzle-overlay').style.display = 'none';
  if (paused) togglePause();
}

function confirmPuzzleNumber() {
  const input = document.getElementById('puzzle-input');
  const displaySeed = parseInt(input.value);
  if (!displaySeed || displaySeed < 1 || displaySeed > MAX_PUBLIC_SEED) {
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 800);
    return;
  }
  const seed = pendingEasySeed ? displaySeed + EASY_SEED_OFFSET : displaySeed;
  window.location.href = `index.html?list=wordlist.txt&seed=${seed}`;
}

// ── Pause / resume ──
function applyPauseUI() {
  const btn = document.getElementById('pause-btn');
  btn.textContent = paused ? 'Resume' : 'Pause';
  document.getElementById('grid').classList.toggle('paused', paused);
}

function togglePause() {
  paused = !paused;
  applyPauseUI();
}

// ── Auto-pause when the tab/window loses focus ──
// Covers switching tabs, switching to another application, and
// minimizing — so score/time can't quietly tick up while you're away.
let autoPausedByBlur = false; // true only if THIS code paused the game (not a modal)

function isAnyModalOpen() {
  return ['archive-overlay', 'random-overlay', 'puzzle-overlay', 'about-overlay']
    .some(id => document.getElementById(id)?.style.display === 'flex');
}

function checkAutoPause() {
  const away = document.hidden || !document.hasFocus();
  if (away) {
    if (!paused && !gameOver) {
      paused = true;
      autoPausedByBlur = true;
      applyPauseUI();
    }
  } else if (paused && autoPausedByBlur && !isAnyModalOpen()) {
    // Only auto-resume if WE auto-paused it, and no modal is covering
    // the grid (a modal's own close button handles resuming that case).
    paused = false;
    autoPausedByBlur = false;
    applyPauseUI();
  }
}

document.addEventListener('visibilitychange', checkAutoPause);
window.addEventListener('blur', checkAutoPause);
window.addEventListener('focus', checkAutoPause);

// ── Archive modal ──
let archiveViewMonth = null;         // Date object for currently displayed month
const archiveFileCache = new Map();  // dateStr -> boolean, caches file-existence checks

async function toggleArchive() {
  const overlay = document.getElementById('archive-overlay');
  overlay.style.display = 'flex';
  if (!paused) togglePause();

  // Default to current month — based on the same local date used to pick
  // today's puzzle, so the calendar always agrees with what's playing.
  if (!archiveViewMonth) {
    const [ty, tm] = TODAY_DATE_DASHED.split('-').map(Number);
    archiveViewMonth = new Date(ty, tm - 1, 1);
  }

  await renderArchiveCalendar();
}

function closeArchive() {
  document.getElementById('archive-overlay').style.display = 'none';
  if (paused) togglePause();
}

function archiveNavMonth(dir) {
  archiveViewMonth.setMonth(archiveViewMonth.getMonth() + dir);
  renderArchiveCalendar();
}

// ── Check whether daily/YYYY-MM-DD.txt actually exists ──
// No manifest to keep in sync — this is the single source of truth for
// which dates have a curated puzzle. Results are cached per session so
// flipping between months doesn't re-fetch the same date repeatedly.
async function dailyFileExists(dateStr) {
  if (archiveFileCache.has(dateStr)) return archiveFileCache.get(dateStr);
  let exists = false;
  try {
    const res = await fetch(`daily/${dateStr}.txt`, { method: 'HEAD', cache: 'no-store' });
    exists = res.ok;
  } catch (e) {}
  archiveFileCache.set(dateStr, exists);
  return exists;
}

async function renderArchiveCalendar() {
  const year  = archiveViewMonth.getFullYear();
  const month = archiveViewMonth.getMonth();
  // Use the same local date as the rest of the game (DAILY_FILE, puzzle
  // seed) — comparing date STRINGS avoids Date-object timezone pitfalls
  // (constructing a Date and re-deriving year/month from it can drift
  // by a day depending on how/when it's read back).
  const todayStr = TODAY_DATE_DASHED;
  const [todayYear, todayMonthNum] = todayStr.split('-').map(Number);
  const todayMonth = todayMonthNum - 1; // 0-indexed, to match Date.getMonth()

  // Month label
  const monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
  document.getElementById('archive-month-label').textContent =
    `${monthNames[month]} ${year}`;

  // No manifest to bound navigation by — any past month is fair game;
  // days without a curated file just fall back to an auto-generated
  // puzzle. Only block navigating into the future.
  document.getElementById('archive-prev').disabled = false;
  document.getElementById('archive-next').disabled =
    year === todayYear && month >= todayMonth;

  // Build calendar grid
  const grid = document.getElementById('archive-grid');
  grid.innerHTML = '';

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.classList.add('cal-day', 'cal-empty');
    grid.appendChild(empty);
  }

  // Day cells — for past days, check directly whether daily/DATE.txt exists
  const checks = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr; // safe: zero-padded ISO strings sort chronologically

    const cell = document.createElement('div');
    cell.classList.add('cal-day');
    cell.textContent = d;

    if (isFuture) {
      cell.classList.add('cal-future');
    } else if (isToday) {
      cell.classList.add('cal-today');
      cell.title = "Today's puzzle";
      cell.addEventListener('click', () => {
        closeArchive();
        window.location.href = 'index.html';
      });
    } else {
      // Neutral styling until the file check resolves
      cell.classList.add('cal-checking');
      cell.addEventListener('click', async () => {
        closeArchive();
        const exists = await dailyFileExists(dateStr);
        if (exists) {
          window.location.href = `index.html?list=daily/${dateStr}.txt`;
        } else {
          const dateSeedInt = parseInt(dateStr.replace(/-/g, '')); // YYYYMMDD
          window.location.href = `index.html?list=wordlist.txt&seed=${dateSeedInt}`;
        }
      });
      checks.push(
        dailyFileExists(dateStr).then(exists => {
          cell.classList.remove('cal-checking');
          if (exists) {
            cell.classList.add('cal-available');
            cell.title = 'Click to play this puzzle';
          } else {
            cell.classList.add('cal-auto');
            cell.title = 'Auto-generated puzzle';
          }
        })
      );
    }

    grid.appendChild(cell);
  }

  await Promise.all(checks);
}

// ── About modal ──
function toggleAbout() {
  const overlay   = document.getElementById('about-overlay');
  const isVisible = overlay.style.display === 'flex';
  overlay.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible && !paused) togglePause();
  else if (isVisible && paused) togglePause();
}
