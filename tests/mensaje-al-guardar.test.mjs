/* El mensaje para el grupo tiene que quedar a la vista al guardar y también al
   corregir una calicata ya guardada. Nada de botón de compartir: abría la hoja
   del teléfono (WhatsApp, correo) en vez de dejar el texto para copiar. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');
const js   = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const css  = readFileSync(new URL('../assets/calicatas.css', import.meta.url), 'utf8');

test('el aviso de guardado trae el mensaje completo', () => {
  assert.match(html, /id="calMensaje"/);
  assert.match(html, /Mensaje para enviar al grupo de WhatsApp/);
  assert.match(js, /caja\.textContent=reporte\?\.report\|\|''/);
});

test('no queda ningún botón ni función de compartir', () => {
  assert.ok(!html.includes('calCompartirMensaje'), 'el botón Compartir debería haber desaparecido');
  assert.ok(!js.includes('shareReport'), 'shareReport debería haber desaparecido');
  assert.ok(!js.includes('navigator.share'), 'ya no se usa la hoja de compartir del teléfono');
});

test('el mensaje se muestra entero y se puede seleccionar', () => {
  assert.match(html, /<pre id="calMensaje" class="guardada-mensaje-texto">/);
  const regla = css.match(/\.guardada-mensaje-texto\{[^}]*\}/);
  assert.ok(regla, 'el mensaje necesita su propia regla, separada de .guardada-texto');
  assert.ok(!/max-height/.test(regla[0]), 'el mensaje ya no se recorta a una cajita con scroll');
  assert.match(regla[0], /user-select:text/);
  assert.match(regla[0], /white-space:pre-wrap/);
});

test('sigue existiendo el botón de copiar', () => {
  assert.match(html, /id="calCopiarMensaje"/);
  assert.match(js, /\$\('#calCopiarMensaje'\)\?\.addEventListener\('click',copyReport\)/);
});

test('al corregir una calicata el aviso lo dice y ofrece el mensaje al día', () => {
  assert.match(js, /const editada=!!editingRecord/);
  assert.match(js, /limpiarTrasGuardar\(built\.value,cuartelGuardado,reporte,sincronizada,editada\)/);
  assert.match(js, /function limpiarTrasGuardar\(item,q,reporte,sincronizada,editada\)/);
  assert.match(js, /actualizada/);
  assert.match(js, /mensaje corregido para reenviarlo al grupo/);
});
