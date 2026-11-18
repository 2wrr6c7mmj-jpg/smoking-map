// public/data/places/ の *.json（index.json 以外）を並べた index.json を作る
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../public/data/places/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const counts = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')).spots.length]));
writeFileSync(new URL('index.json', dir), JSON.stringify({ updated: new Date().toISOString(), files, counts }, null, 1));
console.log(counts);
