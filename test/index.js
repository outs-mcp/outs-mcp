// `node --test test`: Node 22+ runs a folder as one entry file,
// this one, so it loads every *.test.mjs here. When a runner lists the files itself (Node 20 with a folder, a glob,
// or plain `node --test`), it runs this file on its own and the check below skips the imports.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (resolve(process.argv[1] ?? '') === here) {
  for (const f of readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) await import(pathToFileURL(join(here, f)).href);
}
