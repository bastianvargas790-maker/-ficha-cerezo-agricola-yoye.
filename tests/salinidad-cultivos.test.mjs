import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
new Function(readFileSync(new URL('../assets/calicatas-analisis.js', import.meta.url), 'utf8'))();
const { CULTIVOS, referenciaCultivo, ceSondaDeAviso, resumen, FACTOR_SONDA } = globalThis.YoyeAgro;

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

test('el umbral de laboratorio se traduce a un aviso en escala de sonda', () => {
  assert.equal(FACTOR_SONDA, 3);
  assert.equal(ceSondaDeAviso('cerezo'), 0.5);
  const lecturas = [30, 60, 90].flatMap(prof => ['punto_cero', 'linea_izquierda', 'linea_derecha'].map(perfil =>
    ({ perfil, profundidad_cm: prof, humedad_pct: 20, ce_ms_cm: 0.7, temperatura_c: 18, estado: 'medida' })));
  const r = resumen(lecturas, { cultivo: 'Cerezo', raicesCm: 60 });
  const p = r.diagnostico.puntos.find(x => x.clave === 'sales-cultivo');
  assert.ok(p, 'debe explicar el umbral del cultivo');
  assert.match(p.texto, /extracto de saturación/);
  assert.equal(p.nivel, 'atencion', '0,7 de sonda ya está sobre el aviso del cerezo');
  assert.ok(r.diagnostico.acciones.some(a => /extracto de saturación/i.test(a)));
});

test('sin cultivo conocido no se inventa un umbral', () => {
  const lecturas = [{ perfil: 'punto_cero', profundidad_cm: 30, humedad_pct: 20, ce_ms_cm: 0.7, temperatura_c: 18, estado: 'medida' }];
  const r = resumen(lecturas, { cultivo: 'Kiwi' });
  assert.ok(!r.diagnostico.puntos.some(p => p.clave === 'sales-cultivo'));
});
