// main.ts — png-squeeze-01 entry: re-encode every screenshot losslessly,
// as small as possible. One run answers all 8 instances in /input/<id>/,
// writing /output/<id>/image.png. Pure TypeScript, Node's built-ins only,
// nothing installed, fully deterministic (no clock, no randomness).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from './pngenc.ts';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const image = decodePng(new Uint8Array(readFileSync(join(I, id, 'image.png'))));
  if (!image.ok) throw new Error(id + '/image.png: ' + image.why);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'image.png'), encodePng(image.rgba, image.width, image.height));
}
