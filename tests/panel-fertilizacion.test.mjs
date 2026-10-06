import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const paneles = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const campos = readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8');

test('el apartado de fertilización existe y aparece solo donde está habilitado', () => {
  assert.match(campos, /\{mod:'fertilizacion',icon:'🧪',k:'Nutrición',t:'Planilla de fertilización'/);
  // El módulo se muestra por alcance del campo, como el resto: nada de excepciones por slug.
  assert.match(campos, /items=panelesData\(\)\.filter\(p=>tieneModulo\(campo,p\.mod\)\)/);
});

test('el panel abre por clic y por dirección', () => {
  assert.match(paneles, /fertilizacion:\{titulo:'Planilla de fertilización',kicker:'Nutrición'/);
  assert.match(paneles, /HASH_RE=\/\^#panel-\(campos\|aforos\|calicatas\|acido\|descoles\|fertilizacion\)/);
  assert.match(paneles, /'#fertilizacion':'fertilizacion'/);
  assert.match(paneles, /if\(\/#fertilizacion\/\.test\(href\)\)return 'fertilizacion'/);
});

test('el panel enlaza la planilla de fertirriego del campo', () => {
  const bloque = paneles.slice(paneles.indexOf('async function datosFertilizacion'), paneles.indexOf('const PANELES='));
  // La planilla viva de Google, embebida en solo lectura y con enlace para escribir.
  assert.match(bloque, /const PLANILLA_FERT=\{/);
  assert.match(bloque, /id:'1hOfTaiFVGMyRUjAyTOE0DKdoeHQZ1FzJidW5bb6Zd_A'/);
  assert.match(bloque, /\/preview`/, 'el iframe va al preview, no al editor');
  assert.match(bloque, /Abrir en Drive/);
  assert.match(bloque, /class="pd-frame"/);
  assert.match(bloque, /loading="lazy"/);
  // Solo el campo que tiene planilla la muestra.
  assert.match(bloque, /campos:\['rinconada-plano'\]/);
  assert.match(bloque, /tienePlanilla=PLANILLA_FERT\.campos\.includes\(campo\.slug\)/);
  assert.match(bloque, /Todavía no hay planilla de/);
});

test('sigue diciendo qué va a mostrar y qué falta', () => {
  const bloque = paneles.slice(paneles.indexOf('async function datosFertilizacion'), paneles.indexOf('const PANELES='));
  for (const parte of ['Aplicaciones hechas', 'Plan de la temporada', 'Unidades por nutriente', 'Consumo'])
    assert.ok(bloque.includes(parte), `falta ${parte}`);
  assert.match(bloque, /Registrar la fertilización desde la app/);
  // Y avisa si faltan superficies, porque sin ellas no hay dosis por hectárea.
  assert.match(bloque, /faltan las\s+superficies de/);
});

test('el estilo del marco embebido existe y es alto en el teléfono', () => {
  const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
  assert.match(css, /\.pd-frame\{[^}]*height:min\(72vh,620px\)/);
  assert.match(css, /@media \(max-width:560px\)\{\.pd-frame\{height:70vh\}\}/);
  assert.match(css, /\.pd-abrir\{[^}]*min-height:44px/);
});
