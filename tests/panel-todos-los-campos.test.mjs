import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* El panel "Todos los campos". Lo que se mide de verdad -- que el porcentaje
   quepa en su tarjeta y que en el escritorio se repartan de a cuatro -- está en
   pruebas/paneles/revisar-todos-los-campos.mjs. */
const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('function pintarTodos'), js.indexOf('/* ---------- Orquestación'));

test('cada campo es una tarjeta con sus medidores, no cuatro gráficos apilados', () => {
  assert.ok(bloque.includes('const tarjetaCampo='), 'falta la tarjeta por campo');
  assert.ok(bloque.includes("medidor('aforo'") && bloque.includes("medidor('calicata'")
    && bloque.includes("medidor('acido'") && bloque.includes("medidor('descole'"),
    'los cuatro medidores van en la tarjeta');
  // Los tres gráficos de barras que comparaban porcentajes entre campos salieron:
  // un porcentaje de cada campo contra su propio total no es una comparación.
  for (const viejo of ['Avance del aforo por campo', 'Cuarteles con calicata', 'Ácido peracético aplicado'])
    assert.ok(!bloque.includes(`barras('${viejo}`), `${viejo} ya no debería dibujarse como barras`);
  // La superficie sí es comparación entre campos: esa se queda.
  assert.ok(bloque.includes("barras('Superficie por campo'"));
});

test('el medidor es una razón contra su total, con la fracción escrita', () => {
  const m = js.slice(js.indexOf('function medidor('), js.indexOf('function tabla('));
  assert.match(m, /const pct=Math\.max\(0,Math\.min\(100,hechos\/total\*100\)\)/);
  assert.ok(m.includes("if(!total)return"), 'sin total no se dibuja una barra en cero');
  assert.ok(m.includes('aria-label'), 'el medidor se puede leer sin ver el color');
  // El riel es un tono claro del mismo color, no un gris cualquiera.
  assert.match(js, /aforo:\s*\{nombre:'Aforo',\s*color:'#2a78d6',\s*riel:'#d8e8fb'\}/);
});

test('los colores de las cuatro medidas están validados', () => {
  // #2a78d6 · #199e70 · #eb6834 · #a33b8f: ΔE 8,4 en protanopía entre cualquier
  // par y todos sobre 3:1 de contraste con el papel de la app.
  for (const c of ['#2a78d6', '#199e70', '#eb6834', '#a33b8f'])
    assert.ok(js.includes(c), `falta el color ${c}`);
  assert.match(js, /const MEDIDA=\{/);
  assert.ok(js.includes("pd-leyenda-item"), 'la leyenda nombra cada medida');
});

test('en el escritorio las tarjetas se reparten y en el teléfono se apilan', () => {
  assert.match(css, /\.pd-campos-grid\{display:grid;gap:12px;grid-template-columns:1fr\}/);
  assert.match(css, /@media \(min-width:1180px\)\{\.pd-campos-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/);
  // Sin min-width:0 el porcentaje se salía de la tarjeta.
  assert.match(css, /\.pd-medidores>\*\{min-width:0\}/);
});

test('los indicadores dicen cuántos de cuántos, no solo un porcentaje', () => {
  assert.ok(bloque.includes('de ${n0(totSectores)} sectores de riego'));
  assert.ok(bloque.includes('bajo 80%'), 'la uniformidad dice cuántos aforos están bajo el umbral');
  assert.ok(bloque.includes('${n0(totConCalicata)} de ${n0(totCuarteles)}'));
});
