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
