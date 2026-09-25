import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');

test('el clic de la lista se engancha apenas carga el archivo, no en DOMContentLoaded', () => {
  // En el PC, "Todos los campos" no abría: el archivo se ejecutó después de
  // DOMContentLoaded (caché / service worker) y ese evento ya no vuelve.
  assert.match(js, /document\.addEventListener\('click',ev=>\{\s*const a=ev\.target\.closest&&ev\.target\.closest\('a\.yoye-panel-item'\)/);
  assert.match(js, /^enlazarLista\(\);$/m, 'debe engancharse al cargar');
  assert.match(js, /if\(document\.readyState==='loading'\)addEventListener\('DOMContentLoaded',arrancarPaneles\);\s*else arrancarPaneles\(\);/);
});

test('el hash de los enlaces abre el panel por sí solo', () => {
  // Segundo camino: aunque no corra el clic, el navegador cambia el hash.
  assert.match(js, /ALIAS_HASH=\{'#todos-los-campos':'campos','#acido':'acido','#descole':'descoles'/);
  assert.match(js, /\|\|ALIAS_HASH\[location\.hash\]\|\|null/);
});

test('registrar una calicata lleva al formulario sin tener que bajar', () => {
  assert.match(cal, /if\(b\.dataset\.view==='register'\)irAlFormulario\(\)/);
  assert.match(cal, /form\.scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
  assert.match(cal, /cuartel\.focus\(\{preventScroll:true\}\)/);
});
