import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../calicatas/sw.js', import.meta.url), 'utf8');
const pages = ['index.html', 'registro.html', 'registro-v16.html'].map(name =>
  readFileSync(new URL(`../calicatas/${name}`, import.meta.url), 'utf8')
);

test('Supabase and IndexedDB use separate connection variables', () => {
  assert.match(app, /let db,localDb,session/);
  assert.match(app, /if\(localDb\)return Promise\.resolve\(localDb\)/);
  assert.match(app, /request\.onsuccess=\(\)=>\{localDb=request\.result;resolve\(localDb\)\}/);
  assert.doesNotMatch(app, /if\(db\)return Promise\.resolve\(db\)/);
});

test('all Calicatas entry points and the offline shell request the same asset', () => {
  const versionOf = source => (source.match(/calicatas\.js\?v=([0-9a-zA-Z-]+)/) || [])[1];
  const version = versionOf(pages[0]);
  assert.ok(version, 'calicatas.js debe declarar una versión');
  for (const page of pages) assert.equal(versionOf(page), version);
  assert.equal(versionOf(serviceWorker), version);
  assert.match(serviceWorker, /calicatas-campo-v[0-9a-zA-Z-]+/);
});
