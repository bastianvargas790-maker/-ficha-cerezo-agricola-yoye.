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

test('all Calicatas entry points and the offline shell request the fixed asset', () => {
  const version = 'calicatas.js?v=20260821-offline-db-fix-1';
  for (const page of pages) assert.ok(page.includes(version));
  assert.ok(serviceWorker.includes(version));
  assert.ok(serviceWorker.includes("calicatas-campo-v22-offline-db-fix"));
});
