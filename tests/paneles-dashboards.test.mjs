import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/* Los paneles de Aforos y Calicatas eran enlaces a Drive: se salía de la app y
   Google pedía acceso. Ahora se dibujan dentro, con datos de la base. */
const leer = ruta => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const script = leer('../assets/paneles-dashboards.js');
const pagina = leer('../paneles/index.html');

test('la página de paneles carga el dashboard interno', () => {
  assert.ok(existsSync(new URL('../assets/paneles-dashboards.js', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/paneles-dashboards.css', import.meta.url)));
  assert.match(pagina, /paneles-dashboards\.js\?v=/);
  assert.match(pagina, /paneles-dashboards\.css\?v=/);
  assert.match(pagina, /id="yoyePanelVista"/);
});

test('los dos paneles leen de la base, no de una planilla', () => {
  for (const tabla of ['sectores_aforo', 'aforos', 'calicatas', 'lecturas_calicata', 'observaciones_calicata']) {
    assert.ok(script.includes(`from('${tabla}')`), `falta la consulta a ${tabla}`);
  }
});

test('cada panel se limita al campo activo', () => {
  // Sin este filtro un administrador vería los cuatro campos mezclados.
  assert.match(script, /yoyeActiveCampo/);
  assert.ok(script.includes("eq('campo_id',campo.id)"), 'los cuarteles y sectores deben filtrarse por campo');
});

test('los gráficos no dependen de una librería externa', () => {
  assert.ok(!/cdn|jsdelivr|unpkg|chart\.js/i.test(script), 'los gráficos se dibujan en SVG propio');
  assert.match(script, /<svg viewBox/);
});
