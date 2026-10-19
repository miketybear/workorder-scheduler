// An invalid hex colour (for example #fffffffff) is silently dropped by the browser and the element
// inherits another colour, so fail the lint step on any hex that is not 3, 4, 6 or 8 digits long.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function stylesheets(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

const bad = [];
for (const file of stylesheets('src')) {
  for (const match of readFileSync(file, 'utf8').matchAll(/#([0-9a-fA-F]+)\b/g)) {
    if (![3, 4, 6, 8].includes(match[1].length)) bad.push(`${file}: ${match[0]}`);
  }
}
// Throwing prints the list and makes node exit non-zero, which fails `npm run lint`.
if (bad.length > 0) throw new Error(`Invalid hex colours: ${bad.join('; ')}`);
