import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/* El botón "Cuarteles" y los números del Inicio apuntaban a cerezo/#database:
   miraras el campo que miraras, terminabas en la ficha de cerezo sin poder
   cambiar de cultivo. Ahora hay una lista propia; que no se vuelva atrás. */
const leer = ruta => readFileSync(new URL(ruta, import.meta.url), 'utf8');

test('existe la lista de cuarteles', () => {
  assert.ok(existsSync(new URL('../cuarteles/lista.html', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/cuarteles-lista.js', import.meta.url)));
});

test('nada de la navegación manda a la ficha de cerezo', () => {
  for (const ruta of ['../index.html', '../assets/campos.js', '../cuarteles/index.html']) {
    assert.ok(!leer(ruta).includes('cerezo/#'), `${ruta} no debe enlazar a la ficha de cerezo`);
  }
});

test('el Inicio muestra todas las fichas, no solo las del campo', () => {
  const inicio = leer('../index.html');
  assert.match(inicio, /const visibles=crops;/);
  for (const cultivo of ['palto/', 'mandarina/', 'cerezo/', 'nogal/']) {
    assert.ok(inicio.includes(`url:'${cultivo}'`), `falta la ficha ${cultivo}`);
  }
});

test('el Inicio no duplica los accesos de registro que viven en la barra inferior', () => {
  const inicio = leer('../index.html');
  assert.ok(!inicio.includes('Registro de calicatas'));
  assert.ok(!inicio.includes('Registro de aforos'));
});

test('todo el sitio usa el logo oficial', () => {
  for (const ruta of ['../index.html', '../paneles/index.html', '../cuarteles/index.html',
                      '../cuarteles/lista.html', '../aforo/index.html', '../mas/index.html']) {
    assert.ok(!leer(ruta).includes('yoye-logo.svg'), `${ruta} usa el logo genérico`);
  }
});
