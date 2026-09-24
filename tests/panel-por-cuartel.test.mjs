import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('function pintarCalicatas'), js.indexOf('/* ---------- Ácido'));

test('sin cuartel elegido, el panel ofrece elegir uno en vez de mezclarlos', () => {
  assert.ok(bloque.includes("h3 class=\"pd-card-title\">Elige un cuartel"), 'falta la lista de cuarteles');
  assert.ok(bloque.includes('data-cal-cuartel='), 'cada cuartel debe ser tocable');
  assert.ok(bloque.includes('if(!filtroCal.cuartel){'), 'la vista cambia según haya cuartel elegido');
  assert.match(css, /\.pd-cuartel\{/);
});

test('con cuartel elegido, los indicadores son su última calicata y el cambio desde la anterior', () => {
  assert.ok(bloque.includes('const kpisCuartel='));
  assert.ok(bloque.includes('const rPrev=delCuartel[1]?leer(delCuartel[1]):null'));
  assert.ok(bloque.includes('desde ${fecha(delCuartel[1].fecha)}'), 'el cambio debe decir desde qué fecha');
  assert.ok(bloque.includes("kpi('Uniformidad del bulbo'"));
});

test('la evolución del cuartel se dibuja en el tiempo, con la franja de suelo', () => {
  assert.match(js, /function serieTiempo\(titulo,kicker,fechas,series,nota,referencia\)/);
  assert.ok(bloque.includes("serieTiempo('Humedad por fecha'"));
  assert.ok(bloque.includes("serieTiempo('CE por fecha'"));
  assert.ok(bloque.includes('Falta una segunda calicata'), 'con una sola fecha hay que decirlo, no dibujar una línea sola');
  assert.ok(bloque.includes('tabla(\'Historia del cuartel\''));
});

test('se puede enlazar directo a un cuartel desde la app de Calicatas', () => {
  assert.match(js, /const HASH_RE=\/\^#panel-\(campos\|aforos\|calicatas\|acido\|descoles\)\(\?:\:\(\[\^#\?\/\]\+\)\)\?\$\//);
  assert.match(js, /clave==='calicatas'&&cuartel&&filtroCal\.cuartel!==cuartel/);
  assert.match(cal, /href="\.\.\/paneles\/#panel-calicatas:\$\{encodeURIComponent\(q\.codigo\|\|q\.cuartel\|\|''\)\}"/);
});
