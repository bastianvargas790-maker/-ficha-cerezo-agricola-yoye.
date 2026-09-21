import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* Las fotos se sacaron a proposito: una foto de iPhone pesaba 7 MB y unas
   pocas por calicata llenaban el almacenamiento del proyecto. Si alguien
   vuelve a agregar el campo, que sea una decision y no un descuido. */
const script = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const paginas = ['index.html', 'registro.html', 'registro-v16.html'].map(nombre => [
  nombre,
  readFileSync(new URL(`../calicatas/${nombre}`, import.meta.url), 'utf8'),
]);

test('el formulario de calicatas no pide fotografias', () => {
  for (const [nombre, html] of paginas) {
    assert.ok(!html.includes('id="photos"'), `${nombre} no debe tener el campo de fotos`);
    assert.ok(!/type="file"/.test(html), `${nombre} no debe pedir archivos`);
  }
});

test('la app no sube nada al almacenamiento', () => {
  assert.ok(!script.includes('storage.from'), 'calicatas.js no debe usar Storage');
  assert.ok(!script.includes('fotos_calicata'), 'calicatas.js no debe escribir en fotos_calicata');
});

test('la app confirma cuando la calicata llegó a la base', () => {
  // Antes el rótulo se quedaba en "Guardado localmente" aunque ya estuviera
  // sincronizada: quien registra en terreno no sabía si había llegado.
  const js = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
  assert.ok(js.includes('function quedoSincronizada'), 'debe revisar si llegó a la base');
  assert.ok(js.includes('Sincronizada con la base.'), 'debe confirmar el envío');
  assert.ok(js.includes('se enviará sola al recuperar señal'), 'y avisar cuando quedó en el teléfono');
});

test('no queda el aviso de "inicia sesión" con la sesión ya cargada', () => {
  // shared-auth resuelve después del primer aviso; el error rojo se quedaba
  // pegado debajo de un formulario que ya funcionaba.
  const js = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
  const bloque = js.slice(js.indexOf('async function loadProfile'), js.indexOf('async function loadProfile') + 2600);
  assert.ok(/else msg\(''\)/.test(bloque), 'al cargar los cuarteles debe limpiar el mensaje');
});

test('el registro se adapta a pantallas de notebook', () => {
  const css = readFileSync(new URL('../assets/calicatas.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(min-width:1100px\)\{[^}]*\.cal-shell\{max-width:1180px\}/);
  assert.ok(css.includes('#readings{display:grid'), 'las profundidades van de a dos');
  // "No realizada" se cortaba en una columna de 108px.
  assert.match(css, /\.reading-head,\.reading-row\{grid-template-columns:104px 122px/);
});
