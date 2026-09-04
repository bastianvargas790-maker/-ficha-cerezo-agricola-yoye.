import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* El formulario de aforo copia la grilla de la planilla: presiones por válvula
   y emisores por posición × línea. Si esto se rompe, quien afora tiene que
   traducir de un formato a otro en terreno, que es justo lo que se evitó. */
const script = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const estilos = readFileSync(new URL('../assets/campos.css', import.meta.url), 'utf8');

test('las presiones se registran por válvula, no en un solo par', () => {
  assert.match(script, /presiones:Array\.from\(\{length:5\}/);
  assert.match(script, /data-f="presion_entrada"/);
  assert.match(script, /data-f="presion_salida"/);
  assert.match(script, /function presionesPromedio/);
});

test('los emisores se agrupan por posición con una columna por línea', () => {
  assert.match(script, /function bloqueEmisores/);
  assert.match(script, /Volumen \(cc\)/);
  assert.match(script, /Tiempo \(s\)/);
  assert.match(script, /Caudal \(L\/h\)/);
  // 4 posiciones x 4 líneas = las 16 mediciones de siempre
  assert.match(script, /POSICIONES=\['Inicio','1\/3','2\/3','Último'\]/);
  assert.match(script, /LINEAS=\['1ª línea','1\/3 línea','2\/3 línea','Última línea'\]/);
});

test('el tiempo viene con el valor estándar de terreno', () => {
  assert.match(script, /TIEMPO_ESTANDAR='36'/);
  assert.match(script, /tiempo_segundos:TIEMPO_ESTANDAR/);
});

test('el caudal se calcula igual que en la planilla', () => {
  assert.match(script, /\(v\/s\)\*3\.6/);
});

test('las tablas del formulario tienen estilos propios', () => {
  for (const clase of ['.yoye-af-tabla', '.yoye-af-bloque-tit', '.yoye-af-resumen']) {
    assert.ok(estilos.includes(clase), `falta ${clase} en campos.css`);
  }
});
