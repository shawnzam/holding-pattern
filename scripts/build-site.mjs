/*
 * Copies the public part of the game (index.html, css/, js/) into dist/ for
 * Cloudflare, and draws og.png, the home page's link-preview picture. Nothing else is published: not the key, the server, the tests
 * or the sample solutions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardPng } from '../share-card.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
for (const dir of ['css', 'js']) fs.cpSync(path.join(root, dir), path.join(dist, dir), { recursive: true });
// The home page's link-preview picture, drawn by the same code as the shared-score ones.
fs.writeFileSync(path.join(dist, 'og.png'), await cardPng(null));

const files = fs.readdirSync(dist, { recursive: true }).filter(f => fs.statSync(path.join(dist, f)).isFile());
console.log('dist/ ready: ' + files.length + ' files (' + files.join(', ') + ')');
