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

test('ácido y descole también se dibujan dentro de la app', () => {
  // Eran un enlace al archivo en Drive: se salía de la app y pedía acceso.
  assert.ok(script.includes("from('aplicaciones_acido')"), 'deben leer de la base');
  assert.match(script, /acido:\{titulo:'Ácido peracético'/);
  assert.match(script, /descoles:\{titulo:'Descoles'/);
  assert.match(script, /#panel-\(campos\|aforos\|calicatas\|acido\|descoles\)/);
});

test('el descole respeta la regla de la planilla', () => {
  // "No aplica" se excluye del total; "No aplica (plantación nueva)" cuenta
  // como superficie resuelta. Si esto cambia, el avance deja de cuadrar.
  assert.ok(script.includes("!=='No aplica'"), 'debe excluir lo que no aplica');
  assert.match(script, /no aplica \\\(plantaci/);
});

test('cada panel dice de cuándo son los datos', () => {
  assert.match(script, /function actualizacion|const actualizacion/);
  assert.ok(script.includes('planilla oficial del campo'), 'debe declarar el origen');
});

test('hay un panel que compara todos los campos', () => {
  // Los demás paneles miran el campo activo; este los pone lado a lado, que es
  // lo que se pide para revisar los cuatro campos sin ir cambiando de uno en uno.
  assert.match(script, /campos:\{titulo:'Todos los campos'/);
  assert.ok(script.includes('global:true'), 'no debe depender del campo activo');
  assert.ok(script.includes("claveDe") && script.includes('#todos-los-campos'),
    'la lista de paneles debe poder abrirlo');
});

test('el panel de todos los campos no filtra por campo', () => {
  // El filtro lo hacen las políticas de RLS: un jefe de campo debe ver aquí
  // solo el suyo. Si alguien agrega un .eq('campo_id') se rompe esa garantía.
  const bloque = script.slice(script.indexOf('async function datosTodos'),
                              script.indexOf('function pintarTodos'));
  assert.ok(!/eq\('campo_id'/.test(bloque), 'RLS decide qué campos entran, no el cliente');
  assert.ok(bloque.includes('window.yoyeCampos'), 'usa la lista de campos ya autorizada');
});

test('el panel siempre visible se ofrece en cualquier campo', () => {
  const campos = readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8');
  assert.ok(campos.includes("mod:'*'"), 'debe existir un panel sin restricción de alcance');
  assert.match(campos, /function tieneModulo\(campo,mod\)\{return mod==='\*'/);
});

test('un panel sin datos ofrece la acción, no barras en cero', () => {
  // Con cero aforos, "avance por equipo" dibujaba una barra vacía por equipo:
  // parecía roto en vez de parecer pendiente.
  assert.ok(script.includes('function vacioAccion'), 'debe existir el estado vacío con acción');
  assert.match(script, /if\(!aforos\.length\)return kpis\+vacioAccion/);
  assert.match(script, /if\(!calicatas\.length\)return/);
});

test('las tablas de detalle ocupan todo el ancho en notebook', () => {
  // En una columna angosta se cortaba la última columna de la tabla.
  const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
  assert.ok(script.includes('pd-card pd-ancho'), 'las tablas deben marcarse');
  assert.match(css, /\.pd-cuerpo>\.pd-ancho[^{]*\{grid-column:1 \/ -1\}/);
});
