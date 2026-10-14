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
  assert.ok(bloque.includes("serieTiempo('Humedad por profundidad, fecha a fecha'"));
  assert.ok(bloque.includes("serieTiempo('CE por profundidad, fecha a fecha'"));
  // Un solo eje de valores por dibujo: la humedad va en % y la CE en mS/cm.
  assert.equal((serie.match(/const marcas=marcasEje\(/g) || []).length, 1, 'un gráfico, una escala');
  assert.ok(!/ejeDerecho|eje secundario|escalaDerecha/.test(serie), 'nada de un segundo eje');
});

test('la profundidad se pinta como magnitud ordenada, no con colores sueltos', () => {
  // 30 cm claro, 90 cm oscuro: un solo tono. Antes reusaba los colores de
  // Centro/Izquierda/Derecha, que son otra identidad.
  assert.match(js, /const PROF_RAMPA=\['#4a92e4','#20629f','#0f2f52'\]/);
  assert.ok(!bloque.includes('COLORES[i%COLORES.length]'), 'ya no se reusa la paleta de los puntos');
  assert.ok(bloque.includes('color:colorProf(pr,profsSel)'), 'la ficha del cuartel usa la rampa');
  assert.ok(bloque.includes('color:colorProf(x.prof,'), 'el resumen también');
  // El paso se calcula desde la posición de la profundidad, así 60 cm es
  // siempre el tono del medio aunque falte el de 30.
  assert.match(js, /const paso=Math\.round\(i\*\(PROF_RAMPA\.length-1\)\/\(profs\.length-1\)\)/);
});

test('la cobertura del campo es una dona, y cuenta cuarteles sin calicata', () => {
  assert.ok(bloque.includes("anillo(\n    'Cuarteles revisados con calicata'"), 'falta la dona');
  assert.ok(bloque.includes('const revisados=cuarteles.filter(q=>conCalicata.has(q.id)).length'));
  // El denominador son TODOS los cuarteles del campo, no los que tienen calicata.
  assert.ok(bloque.includes('const pendientes=Math.max(0,cuarteles.length-revisados)'));
  assert.ok(bloque.includes("{num:n0(100*revisados/cuarteles.length)+'%'"), 'el centro muestra el porcentaje');
  assert.ok(bloque.includes("etiqueta:'raíces efectivas, promedio'"), 'falta el promedio de raíces');
});

test('el resumen promedia por fecha, no mezcla calicatas sueltas en un punto', () => {
  const r = js.slice(js.indexOf('function resumenPorProfundidad'), js.indexOf('function tablaResumenProf'));
  assert.ok(r.includes('const dia=String(k.fecha).slice(0,10)'), 'se agrupa por día');
  assert.ok(r.includes('v.length?v.reduce((a,b)=>a+b,0)/v.length:null'), 'varias calicatas del día se promedian');
  // Sin medición, hueco: nunca un cero que el gráfico leería como suelo seco.
  assert.ok(r.includes(':null;'), 'la fecha sin dato queda vacía');
  assert.ok(r.includes("tiempos:dias.map(d=>Date.parse(d+'T12:00:00'))"), 'escala de calendario');
});

test('la tabla de resumen acompaña a cada gráfico y ata fila con línea', () => {
  const t = js.slice(js.indexOf('function tablaResumenProf'), js.indexOf('/* ---------- Hacia dónde va el cuartel'));
  assert.ok(t.includes("['Profundidad',`Máx ${unidad}`,`Prom ${unidad}`,`Mín ${unidad}`,`Último ${unidad}`,'Fechas']"));
  // El contraste de la línea más clara se apoya en la tabla: no es opcional.
  assert.ok(t.includes('class="pd-punto"'), 'cada fila lleva el color de su línea');
  assert.ok(!/<td[^>]*color:\$\{/.test(t), 'el texto de la tabla no se pinta del color de la serie');
  assert.match(css, /\.pd-punto\{display:inline-block/);
  assert.ok(bloque.includes("tablaResumenProf(resH,'%',n1,"), 'la humedad lleva su tabla');
  assert.ok(bloque.includes("tablaResumenProf(resCe,'mS/cm',n2,"), 'la CE también');
});

test('las fechas van a escala de calendario y el eje se ajusta a los datos', () => {
  assert.match(serie, /const parte=i=>ts&&t1>t0\?\(ts\[i\]-t0\)\/\(t1-t0\)/);
  assert.ok(bloque.includes('{tiempos:resH.tiempos}'), 'hay que pasarle los tiempos');
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

/* ---------- Hacia dónde va el cuartel ---------- */
test('el cuartel dice si subió o bajó, con el número y con cuántas veces', () => {
  const t = js.slice(js.indexOf('function tendenciaDe('), js.indexOf('/* ---------- Render del panel'));
  assert.match(t, /sostenida:pasos\.length>1&&\(suben===pasos\.length\|\|bajan===pasos\.length\)/,
    'una sola comparación no es una tendencia');
  assert.ok(t.includes("`${sube?'subió':'bajó'} ${f(Math.abs(t.delta))}${ud}`"));
  assert.ok(t.includes("comparaciones seguidas"), 'hay que decir si el movimiento fue sostenido');
  // La resta de dos porcentajes son PUNTOS, no porcentaje.
  assert.ok(t.includes('unidadDelta'), 'la unidad del cambio se pasa aparte');
  assert.ok(bloque.includes("frasesTendencia(tH,'Humedad en la zona de raíces',' %',n1,false,' pp')"));
});

test('la lectura masiva del cuartel va junto a los perfiles de cada calicata', () => {
  assert.ok(bloque.includes('const tendenciaCuartel='), 'falta la tarjeta de tendencia del cuartel');
  assert.ok(bloque.includes('return filtros+kpisCuartel+fichaCab+resumenAlertas+tendenciaCuartel+'),
    'la tendencia va arriba, antes de los gráficos');
  // Y los perfiles de cada calicata siguen estando: se ven las dos cosas.
  assert.ok(bloque.includes('<div class="pd-perfiles">${perfiles}</div>'));
  assert.ok(bloque.includes('const serieZona=clave=>cronologia.map'), 'la serie sale de la zona de raíces');
});

test('cada cuartel de la lista muestra hacia dónde va', () => {
  assert.ok(bloque.includes('const tendenciaCuartelDe=(id,clave)=>'), 'falta la tendencia por cuartel');
  assert.ok(bloque.includes('pd-cuartel-tend'), 'los chips van en la tarjeta del cuartel');
  assert.match(css, /\.pd-tend-chip\{/);
  // Nunca la flecha sola: el número va escrito al lado.
  assert.ok(bloque.includes("f(Math.abs(t.delta))+ud"), 'el chip lleva el número');
});

test('la última calicata de un cuartel se busca por fecha, no por el orden de la consulta', () => {
  assert.ok(bloque.includes('const ultimaDe=id=>sel.filter(k=>k.cuartel_id===id).slice().sort(masNueva)[0]'));
  assert.ok(!bloque.includes('sel.find(k=>k.cuartel_id===id)'), 'ya no se confía en el orden que vino');
  assert.ok(bloque.includes('const ultima=sel.slice().sort(masNueva)[0]'));
});
