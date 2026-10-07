import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* El resumen de tendencias del panel de Calicatas: humedad y conductividad de
   toda la selección en dos gráficos grandes, no uno por calicata. Lo que se
   mide de verdad -- tamaño en pantalla, rótulos que no se pisan -- va en
   pruebas/paneles/revisar-tendencias.mjs, que abre el panel en un navegador. */
const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('function pintarCalicatas'), js.indexOf('/* ---------- Ácido'));
const serie = js.slice(js.indexOf('function serieTiempo'), js.indexOf('function barrasDivergentes'));

test('la humedad y la CE van en dos gráficos, nunca en dos ejes del mismo', () => {
  assert.ok(bloque.includes("serieTiempo('Humedad en la zona de raíces, fecha a fecha'"));
  assert.ok(bloque.includes("serieTiempo('CE en la zona de raíces, fecha a fecha'"));
  // Un solo eje de valores por dibujo: la humedad va en % y la CE en mS/cm.
  assert.equal((serie.match(/const marcas=marcasEje\(/g) || []).length, 1, 'un gráfico, una escala');
  assert.ok(!/ejeDerecho|eje secundario|escalaDerecha/.test(serie), 'nada de un segundo eje');
});

test('cada línea es un cuartel y conserva su color al filtrar', () => {
  assert.match(bloque, /const PALETA_CUARTEL=\['#2a78d6','#eb6834','#199e70','#a33b8f','#8e3d20'\]/);
  // El color se asigna después de elegir, ordenando por código: si se asignara
  // en el orden de la selección, filtrar repintaría los cuarteles que quedan.
  const i = bloque.indexOf('.slice(0,MAX_LINEAS)');
  assert.ok(bloque.slice(i, i + 320).includes("localeCompare(String(b.codigo),'es',{numeric:true})"),
    'el color sale del código del cuartel, no del orden de la lista');
  assert.ok(bloque.includes('color:PALETA_CUARTEL[i]'));
});

test('no se dibujan más cuarteles que colores, y se dice cuántos quedaron fuera', () => {
  assert.match(bloque, /const MAX_LINEAS=PALETA_CUARTEL\.length/);
  assert.ok(bloque.includes('conHistoria.length>MAX_LINEAS?`Se dibujan '), 'hay que avisar cuántos se ven');
  assert.ok(bloque.includes('Todavía no hay dos fechas que comparar'), 'con una sola fecha no se dibuja una línea de un punto');
});

test('las fechas van a escala de calendario y el eje se ajusta a los datos', () => {
  assert.match(serie, /const parte=i=>ts&&t1>t0\?\(ts\[i\]-t0\)\/\(t1-t0\)/);
  assert.ok(bloque.includes('const tendTiempos=tendFechas.map(f=>Date.parse(f'), 'hay que pasarle los tiempos');
  assert.ok(!serie.includes('marcasEje(Math.min(0,'), 'el eje de una línea no tiene por qué partir en cero');
  assert.match(serie, /const marcaEje=v=>entero\?n0\(v\):paso>=0\.1\?n1\(v\):n2\(v\)/);
});

test('el dibujo se arma al ancho de la tarjeta, grande en pc y normal en el teléfono', () => {
  assert.match(js, /const anchoLienzo=\(\)=>\{/);
  assert.match(js, /const altoLienzo=w=>Math\.round\(Math\.max\(240,Math\.min\(420,w\*0\.36\)\)\)/);
  assert.ok(serie.includes('const w=anchoLienzo(), h=altoLienzo(w)'));
  assert.ok(serie.includes('pd-card pd-grafico pd-ancho'), 'la tendencia ocupa todo el ancho');
  // Al girar el teléfono el dibujo se rehace con los datos que ya están en memoria.
  assert.match(js, /addEventListener\('resize'/);
  assert.match(js, /ultimoPintado=\{clave,d,campo\}/);
  assert.match(css, /\.pd-grafico\.pd-ancho \.pd-svg-wrap svg\{min-width:0/);
});

test('la identidad no depende solo del color', () => {
  assert.ok(serie.includes('class="pd-leyenda-item"'), 'siempre hay leyenda');
  assert.ok(serie.includes('class="pd-svg-serie"'), 'cada línea lleva su nombre al borde');
  // El texto va en tinta; el color lo lleva la rayita de al lado.
  assert.ok(!/class="pd-svg-serie" fill="\$\{/.test(serie), 'el texto no se pinta del color de la serie');
  assert.match(css, /\.pd-svg-serie\{font:800 10px/);
});
