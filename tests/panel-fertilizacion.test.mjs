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

test('mientras no haya datos, dice qué va a mostrar y qué falta decidir', () => {
  const bloque = paneles.slice(paneles.indexOf('async function datosFertilizacion'), paneles.indexOf('const PANELES='));
  for (const parte of ['Aplicaciones hechas', 'Plan de la temporada', 'Unidades por nutriente', 'Consumo y stock'])
    assert.ok(bloque.includes(parte), `falta ${parte}`);
  assert.ok(bloque.includes('Registros de fertilización'), 'debe decir cuántos registros hay');
  assert.match(bloque, /Falta definir de dónde salen/);
  // Y avisa si faltan superficies, porque sin ellas no hay dosis por hectárea.
  assert.match(bloque, /faltan las\s+superficies de/);
});
