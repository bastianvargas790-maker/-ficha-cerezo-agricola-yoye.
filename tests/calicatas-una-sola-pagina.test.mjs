import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const leer = n => readFileSync(new URL('../calicatas/' + n, import.meta.url), 'utf8');

// Quedaban tres copias de la app de Calicatas. Un acceso directo antiguo abría
// una versión sin los arreglos nuevos, y ahí se perdían registros.
for (const vieja of ['index.html', 'registro.html']) {
  test(`${vieja} lleva siempre a la versión vigente`, () => {
    const html = leer(vieja);
    assert.match(html, /location\.replace\('\.\/registro-v16\.html'/);
    assert.match(html, /http-equiv="refresh" content="0; url=\.\/registro-v16\.html"/);
    assert.ok(!html.includes('id="calicataForm"'), 'no debe duplicar el formulario');
  });
}

test('la app vigente es registro-v16.html en el manifiesto y el acceso directo', () => {
  assert.match(readFileSync(new URL('../calicatas/manifest.webmanifest', import.meta.url), 'utf8'), /"start_url": "\.\/registro-v16\.html"/);
  assert.match(readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8'), /calicatas\/registro-v16\.html/);
});
