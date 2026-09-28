import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8');
new Function(src)();
const { resumen, referenciaHumedad, estadoHumedad, bandaCE, TEXTURAS } = globalThis.YoyeAgro;

const lecturas = (h, ce = [], t = [], profs = [30, 60, 90]) => profs.flatMap((prof, j) =>
  ['punto_cero', 'linea_izquierda', 'linea_derecha'].map((perfil, i) => ({
    perfil, profundidad_cm: prof, estado: 'medida',
    humedad_pct: h[j]?.[i] ?? null, ce_ms_cm: ce[j]?.[i] ?? null, temperatura_c: t[j]?.[i] ?? null
  })));

test('el total de una calicata pesa igual cada profundidad', () => {
  // 3 puntos por profundidad; si una profundidad tiene un punto menos, esa
  // profundidad no debe pesar menos que las otras.
  const r = resumen(lecturas([[20, 22, 24], [18, 18, null], [10, 10, 10]]), {});
  assert.equal(r.porProfundidad[0].h, 22);
  assert.equal(r.porProfundidad[1].h, 18);
  assert.equal(Math.round(r.total.h * 100) / 100, Math.round(((22 + 18 + 10) / 3) * 100) / 100);
});

test('la zona de raíces se mide hasta donde llegan las raíces, no hasta el fondo del hoyo', () => {
  const r = resumen(lecturas([[20, 20, 20], [20, 20, 20], [40, 40, 40]]), { raicesCm: 60 });
  assert.equal(r.zonaRaices.h, 20, 'el agua de los 90 cm no la toma el árbol');
  assert.equal(r.bajoRaices.h, 40);
  assert.equal(r.frente.clave, 'percola');
  assert.ok(r.diagnostico.acciones.some(a => /más frecuencia|frecuencia/i.test(a)));
});

test('sin raíces declaradas, la zona de raíces son los primeros 60 cm', () => {
  const r = resumen(lecturas([[20, 20, 20], [20, 20, 20], [40, 40, 40]]), {});
  assert.equal(r.zonaRaices.limite, 60);
  assert.deepEqual(r.zonaRaices.profundidades, [30, 60]);
});

test('la humedad se lee contra la referencia de ese suelo, no contra mm de tabla', () => {
  // Criterio de terreno: un suelo pesado bien provisto marca cerca de 30 %,
  // uno medio 24-25 %, y en arenoso no hay número fijo.
  assert.equal(referenciaHumedad('arcillo_arenoso').bien, 30);
  assert.equal(referenciaHumedad('franco').bien, 25);
  assert.equal(referenciaHumedad('arenoso').bien, null);
  assert.equal(referenciaHumedad('textura_inventada'), null);

  const seco = resumen(lecturas([[16, 16, 16], [16, 16, 16], [16, 16, 16]]), { textura: 'franco', raicesCm: 90 });
  assert.equal(seco.zonaRaices.estado.clave, 'critico');
  assert.ok(seco.diagnostico.acciones.some(a => /adelantar|alargar/i.test(a)));
  const comodo = resumen(lecturas([[25, 25, 25], [25, 25, 25], [25, 25, 25]]), { textura: 'franco', raicesCm: 90 });
  assert.equal(comodo.zonaRaices.estado.clave, 'ok');
  const arenoso = resumen(lecturas([[12, 12, 12], [12, 12, 12], [12, 12, 12]]), { textura: 'arenoso', raicesCm: 90 });
  assert.equal(arenoso.zonaRaices.estado.clave, 'info');
  assert.ok(arenoso.diagnostico.acciones.some(a => /calicatas anteriores/i.test(a)));
});

test('ya no se sugieren milímetros a reponer ni agua aprovechable consumida', () => {
  // Esos números salían de una CC y un PMP estimados de tabla: sin análisis de
  // suelo por cuartel dan una precisión que no existe.
  const r = resumen(lecturas([[22, 22, 22], [22, 22, 22], [22, 22, 22]]), { textura: 'franco', raicesCm: 60 });
  assert.equal(r.zonaRaices.laminaFaltante, undefined);
  assert.equal(r.zonaRaices.agotamiento, undefined);
  const todo = JSON.stringify(r.diagnostico);
  assert.ok(!/ mm /.test(todo), 'ninguna frase debe hablar de milímetros');
  assert.ok(!/aprovechable/i.test(todo), 'ninguna frase debe hablar de agua aprovechable consumida');
  assert.ok(!/capacidad de campo/i.test(todo), 'ninguna frase debe prometer capacidad de campo');
  const js = readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8');
  assert.ok(!/laminas?\(/.test(js), 'la función de láminas ya no existe');
});

test('están las seis texturas de la tabla, con su densidad aparente', () => {
  assert.deepEqual(Object.keys(TEXTURAS),
    ['arenoso', 'franco_arenoso', 'franco', 'franco_arcilloso', 'arcillo_arenoso', 'arcilloso']);
  assert.equal(TEXTURAS.arenoso.da, 1.65);
  assert.equal(TEXTURAS.arcilloso.da, 1.25);
  assert.equal(TEXTURAS.arcillo_arenoso.porosidad, 51);
  assert.match(readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8'),
    /<option value="arcillo_arenoso">Arcillo arenoso<\/option>/);
});

test('sin textura no se inventa una referencia', () => {
  const r = resumen(lecturas([[20, 20, 20], [20, 20, 20], [20, 20, 20]]), { raicesCm: 90 });
  assert.equal(r.zonaRaices.referencia, null);
  assert.equal(r.zonaRaices.estado, null);
  assert.ok(r.diagnostico.puntos.some(p => /textura/i.test(p.texto)), 'debe pedir la textura, no suponerla');
});

test('un bulbo disparejo se detecta aunque el promedio se vea bien', () => {
  // 13 / 13 / 30 promedia 18,7: idéntico a un bulbo parejo de 18,7.
  const disparejo = resumen(lecturas([[30, 13, 13], [20, 20, 20], [20, 20, 20]]), { raicesCm: 90 });
  assert.equal(disparejo.uniformidad.clave, 'alerta');
  assert.ok(disparejo.diagnostico.puntos.some(p => p.clave === 'uniformidad'));
  assert.ok(disparejo.diagnostico.acciones.some(a => /gotero/i.test(a)));
  const parejo = resumen(lecturas([[19, 18, 19], [20, 20, 20], [20, 20, 20]]), { raicesCm: 90 });
  assert.equal(parejo.uniformidad.clave, 'ok');
});

test('las bandas de CE son de sonda directa y avisan de confirmar en laboratorio', () => {
  assert.equal(bandaCE(0.1).clave, 'baja');
  assert.equal(bandaCE(0.5).clave, 'normal');
  assert.equal(bandaCE(1.0).clave, 'normal', '1,0 de sonda no es alarma en estos huertos');
  assert.equal(bandaCE(2.4).clave, 'atencion');
  assert.equal(bandaCE(3.5).clave, 'alerta');
  assert.match(bandaCE(3.5).nota, /extracto de saturación/i);
  assert.equal(bandaCE(null), null);
});

test('distingue sales que se lavan de sales que se quedan arriba', () => {
  const lava = resumen(lecturas([[20, 20, 20], [20, 20, 20], [20, 20, 20]],
    [[0.3, 0.3, 0.3], [0.4, 0.4, 0.4], [1.2, 1.2, 1.2]]), { raicesCm: 60 });
  assert.equal(lava.sales.lavando, true);
  const arriba = resumen(lecturas([[20, 20, 20], [20, 20, 20], [20, 20, 20]],
    [[1.2, 1.2, 1.2], [1.0, 1.0, 1.0], [0.3, 0.3, 0.3]]), { raicesCm: 60 });
  assert.equal(arriba.sales.subiendo, true);
  assert.ok(arriba.diagnostico.acciones.some(a => /lavado/i.test(a)));
});

test('las lecturas en blanco no entran en ningún cálculo', () => {
  const r = resumen([
    { perfil: 'punto_cero', profundidad_cm: 30, humedad_pct: 20, ce_ms_cm: null, temperatura_c: null, estado: 'medida' },
    { perfil: 'linea_izquierda', profundidad_cm: 30, humedad_pct: 50, ce_ms_cm: 9, temperatura_c: 9, estado: 'no_realizada' }
  ], {});
  assert.equal(r.porProfundidad[0].h, 20);
  assert.equal(r.porProfundidad[0].puntos, 1);
  assert.equal(r.total.ce, null);
});

test('las referencias por textura son coherentes entre sí', () => {
  for (const [clave, t] of Object.entries(TEXTURAS)) {
    assert.ok(t.cc > t.pmp, `${clave}: la capacidad de campo debe superar al punto de marchitez`);
    assert.ok(t.cc <= 50 && t.pmp >= 2, `${clave}: valores fuera de rango razonable`);
    assert.ok(t.cc < t.porosidad, `${clave}: no puede retener más agua que su porosidad total`);
    assert.equal(t.haVolumen, Math.round((t.ccPeso - t.pmpPeso) * t.da * 10) / 10);
  }
});

test('el registro y el panel cargan el mismo archivo de criterios', () => {
  const registro = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');
  const paneles = readFileSync(new URL('../paneles/index.html', import.meta.url), 'utf8');
  for (const [nombre, html] of [['registro', registro], ['paneles', paneles]])
    assert.match(html, /assets\/calicatas-analisis\.js/, `${nombre} debe cargar el análisis`);
  // y queda disponible sin conexión
  for (const sw of ['../sw.js', '../calicatas/sw.js'])
    assert.match(readFileSync(new URL(sw, import.meta.url), 'utf8'), /calicatas-analisis\.js/);
});

test('la app guarda la textura como observación de horizontes', () => {
  const js = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="textura">/);
  assert.match(html, /value="franco_arcilloso"/);
  assert.match(js, /categoria:'horizontes'/);
  assert.match(js, /\$\('#textura'\)\.value=\(record\.observations\|\|\[\]\)\.find\(o=>o\.categoria==='horizontes'\)\?\.opcion_codigo/);
});

test('el panel dice contra qué referencia se lee la humedad, sin milímetros', () => {
  const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
  assert.ok(!/Falta para capacidad de campo/.test(js), 'ya no se promete una lámina a reponer');
  assert.ok(!/lamina/i.test(js), 'no queda ninguna lámina en el panel');
  assert.ok(!/agotamiento/i.test(js), 'no queda el agua aprovechable consumida');
  assert.match(js, /Bien provisto marca cerca de \$\{n0\(gr\.bien\)\} % de humedad/);
  assert.match(js, /Cómo viene la humedad/);
});
