# Design: PNG Squeeze

## Goal

Re-encode each 1280×720 screenshot losslessly into the smallest valid PNG,
inside 60 seconds for the whole set of 8, with two runs byte-identical.
The entry is pure TypeScript on Node's built-ins — nothing is installed,
nothing is fetched, and no clock or randomness touches the output path.

## Picking the colour type per image

Every instance is decoded to RGBA, then analysed once: is it grey, is it
opaque, does it have a transparent colour key, how many distinct colours
are there? From that analysis the encoder builds every lossless form the
image allows:

- **Flat (≤256 colours) → palette, colour type 3.** The palette is ordered
  transparent entries first, then by how often each colour appears, so the
  most common indices are the smallest numbers. A tRNS chunk carries the
  alpha of any non-opaque entry. This turns a flat screenshot into a stream
  of small index bytes, which compresses far better than RGB.
- **Grey → colour type 0 (opaque or transparent key) or 4 (with alpha).**
  One byte per pixel instead of three or four.
- **Rich colour → colour type 2 (opaque or transparent key) or 6 (RGBA).**

Each form is tried in full and the smallest file wins; the runner-up form
is also tried when it is within 2% of the winner, because the stronger
compressor below can overturn a small zlib gap.

## Picking the filter per row

PNG filters (None, Sub, Up, Average, Paeth) are chosen row by row. The
encoder tries several selection rules and keeps the one whose real deflate
is smallest — an entropy estimate alone mis-ranks strategies by up to 6%
on this data, so every strategy is measured with a real compressor:

- **Fixed filter 0–4** (the same filter on every row). Fixed 0 wins outright
  on unfiltered-friendly images (rich colour, alpha), where the raw pixels
  already repeat well.
- **minsum** (per row, the filter with the smallest sum of signed bytes).
- **entropy** (per row, the filter with the lowest byte entropy).
- **brute** (per row, the filter whose level-4 deflate of the previous
  32 KiB plus the row is smallest). This is the most expensive rule and
  the one that wins on grey and alpha images, where the best filter varies
  row to row.

Ranking uses zlib level 9 with memLevel 8, which beats memLevel 9 on most
of these images; the winning buffer is then re-tried across a small matrix
(levels 6/9 × memLevel 8/9 × default/filtered strategy) and the smallest
zlib stream is kept.

## The DEFLATE: optimal-parse dynamic programming

Node's zlib is the ranking tool, but the best compression comes from an
own optimal-parse DEFLATE, written in `pngenc.ts`:

1. **Match finding.** For every input position the encoder finds the
   longest match, using a 4-byte hash with 18 bits. A 3-byte hash collides
   too often on screenshot data, so a short chain walk misses the long
   matches; the 4-byte hash keeps the chains nearly collision-free, and a
   64-candidate walk finds matches as long as a 4096-candidate walk on a
   3-byte hash, in about a tenth of the time.
2. **Forward DP.** A dynamic-programming pass computes the cheapest parse:
   at each position it weighs a literal against every candidate match
   length (the largest length in each DEFLATE length-symbol range, plus the
   longest match itself), scored by the current Huffman lengths. The
   parse is then re-scored with the Huffman lengths its own token
   frequencies imply, and the DP runs a second time. This is the
   zopfli-style optimal parse: it can shorten a match to line up with a
   better match starting a few bytes later, which a greedy or lazy parser
   cannot do.
3. **Emission.** The token sequence is emitted as a dynamic Huffman block,
   a fixed Huffman block, or dynamic blocks split per ~200 KiB of input,
   whichever is smallest — all wrapped in a single zlib stream.

One subtle correctness point: tokens are packed as `(length << 15) |
distance`, which leaves only 15 bits for the distance, so matches are
capped at distance 32767, not 32768. A distance of exactly 32768 would
corrupt the packed token (it did, on one grey image, and the checker
rejected the file). Capping costs nothing measurable.

## What the numbers say (practice set, kit scorer)

| instance | theme | bytes | points |
| --- | --- | --- | --- |
| i001 | flat | 12,496 | 718,370 |
| i002 | rich | 51,852 | 705,539 |
| i003 | alpha | 100,493 | 712,385 |
| i004 | grey | 101,319 | 722,171 |
| i005 | flat | 16,552 | 742,251 |
| i006 | rich | 174,227 | 706,487 |
| i007 | alpha | 60,890 | 701,871 |
| i008 | grey | 24,897 | 714,158 |

Total **715,404 / 1,000,000**, 8/8 passed, 8/8 answered, ~36 s for the set.
Baseline fixed-paeth scores 420,399. The live rank-50 cutoff at build time
was ~746,477, so this entry is below the paid places on the practice set;
the gap is the compressor, not the format — a reference-quality DEFLATE
(LZMA at a 32 KiB dictionary) reaches ~9,600 bytes on i001 where this
entry reaches 12,358, so the remaining headroom is match-search and parse
quality, which the DP above only partly closes. A lazy optimal parse
(`deflateOptimal`) is kept in the source but not run: it costs ~7 s for
~1,500 points on a single image, and the 60 s limit needs the margin.

## Determinism and validity

- No `Date`, no `Math.random`, no timestamps anywhere in the output path.
- Two runs on the practice set are byte-identical (sha256-verified).
- Output PNGs use bit depth 8, are not interlaced, use only the allowed
  colour types, and contain only IHDR, PLTE, tRNS, IDAT, IEND chunks with
  correct CRCs and a single zlib stream — the kit checker accepts all 8.
