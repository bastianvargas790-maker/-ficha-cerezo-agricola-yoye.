import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* Al guardar, el formulario quedaba LLENO detrás del resumen. Para registrar
   otra había que recargar, y si se cambiaba el cuartel y se guardaba, la
   calicata anterior se duplicaba en otro cuartel: el 07/09 CI12-9 quedó con
   las 9 lecturas exactas de C-5. */
const js = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');

test('guardar limpia el formulario', () => {
  assert.ok(js.includes('function limpiarTrasGuardar'), 'falta el flujo tras guardar');
  const f = js.slice(js.indexOf('function limpiarTrasGuardar'), js.indexOf('function limpiarTrasGuardar') + 400);
  assert.match(f, /resetForm\(\)/, 'debe vaciar el formulario');
  assert.match(js, /limpiarTrasGuardar\(built\.value,cuartelGuardado,reporte,sincronizada\)/);
});

test('guardar ya no esconde el formulario detrás del resumen', () => {
  const save = js.slice(js.indexOf('async function save(e)'), js.indexOf('async function save(e)') + 1400);
  assert.ok(!/renderReport\(/.test(save), 'el resumen no debe abrirse solo al guardar');
});

test('hay un aviso de lo guardado arriba del formulario', () => {
  assert.match(html, /<div id="calGuardada" class="guardada" role="status" hidden>/);
  assert.ok(html.indexOf('id="calGuardada"') < html.indexOf('id="calicataForm"'), 'el aviso va antes del formulario');
});

test('el resumen para WhatsApp sigue a un toque', () => {
  assert.match(html, /id="calVerResumen"/);
  assert.match(js, /\$\('#calVerResumen'\)\?\.addEventListener\('click',\(\)=>\{if\(ultimoGuardado\)renderReport\(/);
});

test('el aviso se va al empezar la siguiente', () => {
  assert.match(js, /\$\('#cuartelId'\)\.addEventListener\('change',\(\)=>\{const b=\$\('#calGuardada'\);if\(b\)b\.hidden=true\}\)/);
});

test('ya no se ofrece volver al formulario ya guardado', () => {
  // "Editar observaciones" volvía a la calicata guardada y al guardar de nuevo
  // creaba otra con otro identificador.
  assert.match(html, /<button hidden[^>]*id="editObservations"/);
  assert.match(html, /id="backToCalicata"[^>]*>Registrar otra calicata</);
});
