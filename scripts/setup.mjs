import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
const defaults = await readFile('.env.example', 'utf8');
let existing;
try {
  existing = await readFile('.env', 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  existing = '';
}
const present = parse(existing);
let source = existing;
for (const line of defaults.split(/\r?\n/)) {
  const key = line.split('=')[0];
  if (!line.includes('=') || Object.hasOwn(present, key)) continue;
  const value = line.includes('replace-with-') ? `${key}=${randomBytes(32).toString('hex')}` : line;
  source += `\n${value}`;
}
await writeFile('.env', source + '\n', { mode: 0o600 });
console.log('Added missing configuration defaults; existing settings and secrets were preserved.');
