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
  assert.match(js, /caja\.textContent=reporte\?\.report/);
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
  assert.match(js, /limpiarTrasGuardar\(built\.value,cuartelGuardado,reporte,navigator\.onLine\?'guardando':'pendiente',editada\)/);
  assert.match(js, /function limpiarTrasGuardar\(item,q,reporte,estado,editada\)/);
  assert.match(js, /actualizada/);
  assert.match(js, /mensaje corregido para reenviarlo al grupo/);
});

test('el aviso sale sin esperar a que suba a la base', () => {
  // En terreno la señal es mala: si el aviso esperaba la respuesta de la base,
  // había que quedarse mirando la pantalla, y si la subida fallaba a medias el
  // recuadro podía quedar en blanco.
  const save = js.slice(js.indexOf('async function save(e)'), js.indexOf('async function save(e)') + 2200);
  const iAviso = save.indexOf('limpiarTrasGuardar(');
  const iSync  = save.indexOf('await syncQueue()');
  assert.ok(iAviso > -1 && iSync > -1, 'faltan el aviso o la sincronización');
  assert.ok(iAviso < iSync, 'el aviso debe pintarse antes de sincronizar');
  assert.match(js, /pintarGuardada\(\{q:cuartelGuardado,reporte,estado:await quedoSincronizada\([^)]*\)\?'sincronizada':'pendiente',editada\}\)/);
});

test('el recuadro del mensaje nunca queda en blanco', () => {
  assert.match(js, /No se pudo armar el mensaje para el grupo/);
  const f = js.slice(js.indexOf('function pintarGuardada'), js.indexOf('function limpiarTrasGuardar'));
  assert.match(f, /caja\.textContent=reporte\?\.report\s*\|\|/, 'debe haber un texto de respaldo');
  assert.match(f, /guardada-titulo'\)\.textContent=editada/, 'el título siempre se escribe');
});

test('mientras sube, el aviso lo dice', () => {
  assert.match(js, /Subiéndola a la base…/);
  assert.match(js, /Subiéndolos a la base…/);
});
