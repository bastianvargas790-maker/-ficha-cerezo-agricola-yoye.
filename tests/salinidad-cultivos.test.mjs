import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
new Function(readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8'))();
const { CULTIVOS, referenciaCultivo, resumen, bandaCE } = globalThis.YoyeAgro;

test('los umbrales de sales están para los cultivos de los cuatro campos', () => {
  for (const c of ['cerezo', 'ciruelo', 'duraznero', 'nectarino', 'nogal', 'naranjo', 'palto'])
    assert.ok(CULTIVOS[c] && CULTIVOS[c].umbral > 0, `falta ${c}`);
  // Valores de las tablas de tolerancia (CEe, extracto de saturación).
  assert.equal(CULTIVOS.cerezo.umbral, 1.5);
  assert.equal(CULTIVOS.duraznero.umbral, 1.7);
  assert.equal(CULTIVOS.naranjo.umbral, 1.3);
  // Cada uno declara de dónde sale el número.
  for (const c of Object.values(CULTIVOS)) assert.ok(c.fuente && c.fuente.length > 5);
});

test('el cultivo se reconoce aunque esté escrito de otra forma', () => {
  assert.equal(referenciaCultivo('cerezos').clave, 'cerezo');
  assert.equal(referenciaCultivo('Nectarines').clave, 'nectarino');
  assert.equal(referenciaCultivo('NOGALES').clave, 'nogal');
  assert.equal(referenciaCultivo('Palto Hass').clave, 'palto');
  assert.equal(referenciaCultivo('trigo'), null);
});

test('el umbral del cultivo se muestra como referencia, no se traduce a sonda', () => {
  // Dividir el umbral de laboratorio por un factor fijo dejaba a un ciruelo
  // "en alerta" con 1,0 mS/cm de sonda, que en terreno no tiene nada de grave.
  const js = readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8');
  assert.ok(!/FACTOR_SONDA/.test(js), 'ya no se convierte el umbral a escala de sonda');
  assert.ok(!/ceSondaDeAviso/.test(js), 'ya no existe el aviso convertido');

  const lecturas = [30, 60, 90].flatMap(prof => ['punto_cero', 'linea_izquierda', 'linea_derecha'].map(perfil =>
    ({ perfil, profundidad_cm: prof, humedad_pct: 20, ce_ms_cm: 1.0, temperatura_c: 18, estado: 'medida' })));
  const r = resumen(lecturas, { cultivo: 'ciruelos', raicesCm: 60 });
  const p = r.diagnostico.puntos.find(x => x.clave === 'sales-cultivo');
  assert.ok(p, 'debe nombrar el umbral del cultivo');
  assert.equal(p.nivel, 'info', 'es una referencia, no una alarma');
  assert.match(p.texto, /ciruelo/);
  assert.match(p.texto, /no se compara directo con la sonda/);

  // 1,0 mS/cm de sonda en ciruelo no puede salir como alerta.
  const sales = r.diagnostico.puntos.find(x => x.clave === 'sales');
  assert.equal(sales.nivel, 'info');
  assert.match(sales.texto, /dentro de lo corriente/i);
  assert.ok(!r.diagnostico.acciones.some(a => /lavado/i.test(a)), 'no corresponde hablar de lavado con 1,0');
});

test('la CE alta de verdad sí avisa, y explica que la sonda no es el laboratorio', () => {
  const lecturas = [30, 60].flatMap(prof => ['punto_cero'].map(perfil =>
    ({ perfil, profundidad_cm: prof, humedad_pct: 20, ce_ms_cm: 3.6, temperatura_c: 18, estado: 'medida' })));
  const r = resumen(lecturas, { cultivo: 'ciruelos', raicesCm: 60 });
  const sales = r.diagnostico.puntos.find(x => x.clave === 'sales');
  assert.equal(sales.nivel, 'alerta');
  assert.ok(r.diagnostico.acciones.some(a => /extracto de saturación/i.test(a)));
});

test('la CE de sonda se explica en la dirección correcta: baja cuando el suelo se seca', () => {
  const js = readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8');
  assert.ok(!/se dispara con el suelo húmedo/.test(js), 'esa frase apuntaba al revés en suelo seco');
  assert.match(js, /baja cuando el suelo se seca/);
  assert.match(bandaCE(0.1).nota, /medido muy seco/);
});

test('sin cultivo conocido no se inventa un umbral', () => {
  const lecturas = [{ perfil: 'punto_cero', profundidad_cm: 30, humedad_pct: 20, ce_ms_cm: 0.7, temperatura_c: 18, estado: 'medida' }];
  const r = resumen(lecturas, { cultivo: 'Kiwi' });
  assert.ok(!r.diagnostico.puntos.some(p => p.clave === 'sales-cultivo'));
});
