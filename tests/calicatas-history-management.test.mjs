import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../assets/calicatas.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../calicatas/sw.js', import.meta.url), 'utf8');
const pages = ['index.html', 'registro.html', 'registro-v16.html'].map(name =>
  readFileSync(new URL(`../calicatas/${name}`, import.meta.url), 'utf8')
);

test('history exposes edit and recoverable delete actions', () => {
  assert.match(app, /data-edit-calicata/);
  assert.match(app, /data-delete-calicata/);
  assert.match(app, /update\(\{activo:false,actualizado_por:session\.user\.id\}\)/);
  assert.match(app, /select\('id'\)\.maybeSingle\(\)/);
  assert.match(styles, /\.history-actions/);
  assert.match(styles, /\.history-delete/);
});

test('editing preserves record identity and synchronizes child changes', () => {
  assert.match(app, /editingRecord=null/);
  assert.match(app, /const id=existing\?\.id\|\|uuid\(\)/);
  assert.match(app, /removedReadingIds/);
  assert.match(app, /removedObservationIds/);
  assert.match(app, /from\('lecturas_calicata'\)\.delete\(\)/);
  assert.match(app, /from\('observaciones_calicata'\)\.delete\(\)/);
  assert.match(app, /Guardar cambios/);
});

test('all offline entry points request the history management release', () => {
  const scriptVersion = 'calicatas.js?v=20260823-history-management-1';
  const styleVersion = 'calicatas.css?v=20260823-history-management-1';
  for (const page of pages) {
    assert.ok(page.includes(scriptVersion));
    assert.ok(page.includes(styleVersion));
  }
  assert.ok(serviceWorker.includes(scriptVersion));
  assert.ok(serviceWorker.includes(styleVersion));
  assert.ok(serviceWorker.includes('calicatas-campo-v24-history-management'));
});
