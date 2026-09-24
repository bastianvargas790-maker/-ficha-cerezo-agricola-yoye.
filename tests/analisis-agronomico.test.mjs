import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8');
new Function(src)();
const { resumen, agotamiento, bandaCE, TEXTURAS } = globalThis.YoyeAgro;

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

test('el agotamiento se calcula con la textura de la tabla del campo y marca el estado', () => {
  // Franco de la tabla: CC 22 % y PMP 10 % en peso seco, Da 1,40 → en volumen,
  // CC 30,8 % y PMP 14 %. La sonda mide volumen, así que ese es el par que manda.
  assert.equal(TEXTURAS.franco.cc, 30.8);
  assert.equal(TEXTURAS.franco.pmp, 14);
  assert.equal(Math.round(agotamiento(22.4, 'franco')), 50, 'la mitad del agua aprovechable');
  assert.equal(agotamiento(19, 'textura_inventada'), null);
  const seco = resumen(lecturas([[16, 16, 16], [16, 16, 16], [16, 16, 16]]), { textura: 'franco', raicesCm: 90 });
  assert.equal(seco.zonaRaices.estado.clave, 'critico');
  assert.ok(seco.diagnostico.acciones.some(a => /regar|alargar/i.test(a)));
  const comodo = resumen(lecturas([[29, 29, 29], [29, 29, 29], [29, 29, 29]]), { textura: 'franco', raicesCm: 90 });
  assert.equal(comodo.zonaRaices.estado.clave, 'ok');
});

test('la lámina en milímetros coincide con la capacidad de retención de la tabla', () => {
  // CR de la tabla × profundidad tiene que dar lo mismo que (CC − PMP) × profundidad.
  for (const [clave, t] of Object.entries(TEXTURAS)) {
    const porCr = t.cr * 600;                       // 60 cm = 600 mm de suelo
    const porDiferencia = (t.cc - t.pmp) / 100 * 600;
    assert.ok(Math.abs(porCr - porDiferencia) < porCr * 0.06,
      `${clave}: CR ${t.cr} mm/mm no calza con CC−PMP (${porCr.toFixed(1)} vs ${porDiferencia.toFixed(1)} mm)`);
  }
  const r = resumen(lecturas([[22, 22, 22], [22, 22, 22], [22, 22, 22]]), { textura: 'franco', raicesCm: 60 });
  assert.equal(Math.round(r.zonaRaices.laminaUtil), 101, '60 cm de franco guardan ~101 mm');
  assert.equal(Math.round(r.zonaRaices.laminaFaltante), 53, 'faltan ~53 mm para capacidad de campo');
  assert.ok(r.diagnostico.puntos.some(p => p.clave === 'lamina' && /mm de agua/.test(p.texto)));
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

test('sin textura no se inventa el agua aprovechable', () => {
  const r = resumen(lecturas([[20, 20, 20], [20, 20, 20], [20, 20, 20]]), { raicesCm: 90 });
  assert.equal(r.zonaRaices.agotamiento, null);
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
  assert.equal(bandaCE(0.9).clave, 'atencion');
  assert.equal(bandaCE(2).clave, 'alerta');
  assert.match(bandaCE(2).nota, /extracto de saturación/i);
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

test('el panel muestra los milímetros que faltan y de dónde salen', () => {
  const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
  assert.match(js, /kpi\('Falta para capacidad de campo'/);
  assert.match(js, /la zona de raíces guarda \$\{n0\(zUlt\.laminaUtil\)\} mm llena/);
  // La ficha explica con qué números se calculó, incluida la conversión a volumen.
  assert.match(js, /en humedad volumétrica/);
  assert.match(js, /en peso seco, Da/);
  assert.match(js, /capacidad de retención \$\{n2\(r\.textura\.cr\)\} mm\/mm/);
});
