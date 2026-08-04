# XRDICA

A word-decoding puzzle game by Pehr Jansson.

---

## How to Play

XRDICA is a word-decoding puzzle. Each letter of the alphabet has been assigned a random number — your job is to figure out which number maps to which letter.

### The Grid

The puzzle presents several rows, each containing a hidden word. Every tile shows a number — the **cipher** for the letter in that position. The same number always means the same letter, everywhere in the grid.

### Making Guesses

Click any tile to select it (it will be highlighted), then type a letter to enter your guess. Your guess appears above the cipher number. Use the **arrow keys** to move between tiles, and **Backspace** to clear and step back.

You can only work on one row at a time. If you move to a different row, your uncommitted guesses on the previous row are cleared.

### Submitting a Guess

When every tile in a row has a letter entered, the **GUESS** button lights up. Press it (or hit Enter) to check your answer:

- **Green tiles** — correct! Those letters are locked in and will appear throughout the grid wherever that cipher appears.
- **Red tiles** — incorrect. Your next action will clear them so you can try again.

### Strategy

Because the same cipher always means the same letter, solving one word gives you clues about all the others. If you think a letter might be right for a particular cipher, type it in — if it only maps to one cipher in your current row, it will appear as a faint hint in the other rows too.

### Scoring

Lower is better. You score one point for each letter key or backspace pressed, and one point every five seconds. Correct guesses on a GUESS deduct one point each — so thinking before you type pays off.

### New Rows

Every 60 points, a new word is added to the bottom of the grid, up to a maximum of 10 rows. The puzzle is complete when all rows are solved.

Good luck!

---

## License

Copyright (c) 2025 Pehr Jansson. All rights reserved.

This software and its source code are the exclusive property of Pehr Jansson.
No part of this software, including but not limited to the source code, game
design, and associated assets, may be used, copied, modified, merged,
published, distributed, sublicensed, or sold, in whole or in part, without
the express prior written permission of Pehr Jansson.

Access to this software for the purpose of beta testing is granted on a
personal, non-transferable basis and does not constitute a license to use,
copy, or distribute the software for any other purpose.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED. IN NO EVENT SHALL PEHR JANSSON BE LIABLE FOR ANY CLAIM, DAMAGES, OR
OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.
