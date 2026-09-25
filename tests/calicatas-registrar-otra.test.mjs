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

test('el mensaje para WhatsApp aparece al guardar, listo para copiar', () => {
  // Antes había una tarjeta de resumen aparte, que quedaba en pantalla aunque
  // ya no se ocupara. El mensaje ahora vive en el aviso verde del guardado.
  assert.match(html, /id="calMensaje"/);
  assert.match(html, /Mensaje para enviar al grupo de WhatsApp/);
  assert.match(html, /id="calCopiarMensaje"[^>]*>|>Copiar mensaje</);
  assert.ok(!html.includes('id="reportCard"'), 'la tarjeta de resumen ya no existe');
  assert.ok(!html.includes('calVerResumen'), 'ya no hay botón para abrirla');
  assert.match(js, /if\(caja\)caja\.textContent=reporte\?\.report\|\|''/);
  assert.match(js, /\$\('#calCopiarMensaje'\)\?\.addEventListener\('click',copyReport\)/);
  assert.match(js, /Mensaje copiado\. Pégalo en el grupo de WhatsApp\./);
});

test('el aviso se va al empezar la siguiente', () => {
  assert.match(js, /\$\('#cuartelId'\)\.addEventListener\('change',\(\)=>\{const b=\$\('#calGuardada'\);if\(b\)b\.hidden=true\}\)/);
});

test('ya no se ofrece volver al formulario ya guardado', () => {
  // "Editar observaciones" volvía a la calicata guardada y al guardar de nuevo
  // creaba otra con otro identificador. Esa tarjeta y sus botones ya no existen;
  // para corregir algo está Editar en la lista de últimas calicatas.
  for (const viejo of ['editObservations', 'backToCalicata', 'copyReport', 'shareReport'])
    assert.ok(!html.includes(`id="${viejo}"`), `${viejo} debería haber desaparecido`);
  assert.match(html, /data-edit-calicata|id="calRecientes"/);
});
