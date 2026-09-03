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

test('all offline entry points request the same release as the service worker', () => {
  // No fijamos la versión a mano: comprobamos que todas las entradas pidan
  // exactamente la misma, que es lo que evita que el navegador siga sirviendo
  // una copia vieja después de un cambio.
  const versionOf = (source, asset) => {
    const match = source.match(new RegExp(`${asset}\\?v=([0-9a-zA-Z-]+)`));
    return match && match[1];
  };
  const scriptVersion = versionOf(pages[0], 'calicatas\\.js');
  const styleVersion = versionOf(pages[0], 'calicatas\\.css');
  assert.ok(scriptVersion, 'calicatas.js debe declarar una versión');
  assert.ok(styleVersion, 'calicatas.css debe declarar una versión');
  for (const page of pages) {
    assert.equal(versionOf(page, 'calicatas\\.js'), scriptVersion);
    assert.equal(versionOf(page, 'calicatas\\.css'), styleVersion);
  }
  assert.equal(versionOf(serviceWorker, 'calicatas\\.js'), scriptVersion);
  assert.equal(versionOf(serviceWorker, 'calicatas\\.css'), styleVersion);
  assert.match(serviceWorker, /const CACHE='calicatas-campo-v[0-9a-zA-Z-]+'/);
});
