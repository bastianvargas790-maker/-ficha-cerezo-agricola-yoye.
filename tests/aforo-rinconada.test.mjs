import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/aforo.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../aforo-rinconada/index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../aforo-rinconada/sw.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/202608231_aforo_rinconada.sql', import.meta.url), 'utf8');

test('Supabase client and IndexedDB handle use separate variables from the start', () => {
  assert.match(app, /let sb, localDb, session/);
  assert.doesNotMatch(app, /\bdb\b\s*=\s*request\.result/);
});

test('caudal and CU formulas match the documented Aforo Rinconada criteria', () => {
  assert.match(app, /volumenMl \* 3\.6\) \/ tiempoS/); // L/h = mL * 3.6 / s
  assert.match(app, /CU_ACEPTABLE = 70/); // matches the dashboard's documented CU >= 70% threshold
  assert.match(app, /\(q25 \/ qMedio\) \* 100/); // CU = cuarto inferior / caudal medio
});

test('the 16-measurement matrix covers 4 lines x 4 positions', () => {
  assert.match(app, /LINEAS = \[1, 2, 3, 4\]/);
  assert.match(app, /POSICIONES = \[\['inicio'.*\['ultimo'/);
});

test('index.html, service worker and asset versions stay in sync', () => {
  const version = 'aforo.js?v=20260823-1';
  assert.ok(html.includes(version), 'index.html should request the versioned aforo.js');
  assert.ok(serviceWorker.includes(version), 'sw.js should precache the same aforo.js version');
  assert.ok(html.includes('aforo.css?v=20260823-1'));
});

test('the app reuses the shared Yoye auth gate, not a bespoke login', () => {
  assert.match(html, /shared-auth\.js\?v=20260821-official-logo-1/);
  assert.match(app, /yoye-auth-ready/);
});

test('CU result styling distinguishes accepted vs attention-needed uniformity', () => {
  assert.match(css, /\.result-card\.cu-good b\{color:var\(--green\)\}/);
  assert.match(css, /\.result-card\.cu-bad b\{color:var\(--amber\)\}/);
});

test('the Supabase migration scopes aforos to an organización and keeps them auditable', () => {
  assert.match(migration, /create table if not exists public\.aforos/);
  assert.match(migration, /create table if not exists public\.aforo_lecturas/);
  assert.match(migration, /references public\.organizaciones\(id\)/);
  assert.match(migration, /private\.es_miembro\(organizacion_id\)/);
  assert.match(migration, /create trigger auditar_aforos/);
  assert.match(migration, /unique \(aforo_id, linea, posicion\)/);
});
