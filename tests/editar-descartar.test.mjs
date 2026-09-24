import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/calicatas.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');

test('el registro muestra las últimas calicatas con editar y descartar', () => {
  assert.match(html, /id="calRecientes"/);
  assert.match(html, /id="calRecientesLista"/);
  assert.match(js, /data-edit-calicata="\$\{esc\(c\.id\)\}"/);
  assert.match(js, /data-delete-calicata="\$\{esc\(c\.id\)\}">Descartar/);
  assert.match(css, /\.recientes-item\{/);
});

test('la lista se arma con lo sincronizado y lo que espera en el teléfono', () => {
  const b = js.slice(js.indexOf('async function cargarRecientes'), js.indexOf('function buscarCalicata'));
  assert.ok(b.includes(".in('cuartel_id',idsCuarteles())"), 'solo cuarteles del campo activo');
  assert.ok(b.includes("status!=='synced'"), 'incluye las pendientes del dispositivo');
  assert.ok(b.includes('.limit(12)'));
});

test('editar y descartar alcanzan a las calicatas de esa lista', () => {
  assert.match(js, /function buscarCalicata\(id\)\{return recientes\.find/);
  assert.match(js, /async function editHistoryRecord\(id\)\{const record=buscarCalicata\(id\)/);
  assert.match(js, /async function deleteHistoryRecord\(id\)\{const record=buscarCalicata\(id\)/);
  // Descartar nunca borra: marca activo=false, como el resto del sistema.
  assert.match(js, /update\(\{activo:false,actualizado_por:session\.user\.id\}\)/);
});

test('dos toques seguidos en Guardar no registran dos veces', () => {
  assert.match(js, /if\(guardando\)return;/);
  assert.match(js, /guardando=true;button\.disabled=true;/);
  assert.match(js, /finally\{guardando=false;button\.disabled=false\}/);
});
