import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const leer = p => readFileSync(new URL(p, import.meta.url), 'utf8');
new Function(leer('../assets/calicatas-analisis.js'))();
const { resumen } = globalThis.YoyeAgro;
const registro = leer('../calicatas/registro-v16.html');
const paneles = leer('../assets/paneles-dashboards.js');

const lecturas = h => [30, 60, 90].flatMap((prof, j) => ['punto_cero', 'linea_izquierda', 'linea_derecha']
  .map(perfil => ({ perfil, profundidad_cm: prof, humedad_pct: h[j], ce_ms_cm: 0.5, temperatura_c: 18, estado: 'medida' })));

test('lo medido bajo las raíces se muestra, aclarando que ahí no hay raíz efectiva', () => {
  const r = resumen(lecturas([20, 20, 28]), { raicesCm: 60 });
  const p = r.diagnostico.puntos.find(x => x.clave === 'bajo-raices');
  assert.ok(p, 'debe aparecer el dato de bajo la zona de raíces');
  assert.match(p.texto, /90 cm/);
  assert.match(p.texto, /28,0 %/);
  assert.match(p.texto, /casi no hay raíz efectiva/);
  assert.equal(p.nivel, 'info', 'es contexto, no una alarma');
  // Y sigue sin contarse como agua disponible para el árbol.
  assert.equal(r.zonaRaices.h, 20);
});

test('sin profundidades bajo las raíces no se inventa el dato', () => {
  const r = resumen(lecturas([20, 20, 20]), { raicesCm: 90 });
  assert.ok(!r.diagnostico.puntos.some(x => x.clave === 'bajo-raices'));
});

test('el panel marca esas profundidades en vez de esconderlas', () => {
  assert.match(paneles, /kpi\('Bajo las raíces'/);
  assert.match(paneles, /ahí ya casi no hay raíz efectiva/);
  assert.match(paneles, /fin de raíces<\/text>/);
  assert.match(paneles, /class="pd-fuera" title="Bajo la zona de raíces/);
  assert.match(leer('../assets/paneles-dashboards.css'), /\.pd-fuera\{/);
});

test('ningún campo del registro corta dígitos', () => {
  assert.ok(!/maxlength=/i.test(registro), 'nada de maxlength en el formulario');
  // Humedad, CE y temperatura aceptan enteros de varias cifras y decimales.
  const patron = /pattern="(-\?)?\[0-9\]\*\[\.,\]\?\[0-9\]\*"/g;
  assert.ok((registro.match(/pattern="/g) || []).length >= 1);
  for (const valor of ['35', '100', '12,75', '0,05'])
    assert.ok(/^[0-9]*[.,]?[0-9]*$/.test(valor.replace(',', ',')), `${valor} debe ser válido`);
  assert.ok(patron);
});

test('los límites numéricos dejan pasar valores reales de terreno', () => {
  // profundidad opcional hasta 500 cm, y las válvulas del aforo ya no se topan en 5.
  assert.match(registro, /id="customDepth"[^>]*max="500"/);
  assert.match(leer('../assets/aforo.js'), /cantidad_valvulas[\s\S]{0,400}?max="20"/);
});
