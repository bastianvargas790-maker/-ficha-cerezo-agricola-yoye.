import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* El teclado del teléfono en español pone coma decimal, y un input type="number"
   la descarta EN SILENCIO: "0,62" llegaba como 62 y "1,2" bar como 12. No
   rechazaba el valor -- lo guardaba multiplicado. Una calicata real del 21/09
   quedó con CE de 4 a 15 mS/cm por esto. */
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const afo = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');

test('las lecturas de calicata no son type="number"', () => {
  for (const c of ['humidity', 'ce', 'temp'])
    assert.match(cal, new RegExp(`<input class="${c}" type="text" inputmode="decimal"`), `${c} debe aceptar coma`);
});

test('calicatas convierte la coma a punto al leer', () => {
  assert.ok(cal.includes("const aNumero=v=>"), 'falta el conversor');
  assert.match(cal, /replace\(',','\.'\)/);
  assert.match(cal, /const readValue=\(row,cls\)=>aNumero\(/);
  assert.match(cal, /const num=id=>aNumero\(/);
});

test('horas y duración del riego aceptan coma', () => {
  assert.match(html, /<input id="horasRiego" type="text" inputmode="decimal"/);
  assert.match(html, /<input id="duracionRiego" type="text" inputmode="decimal"/);
});

test('las profundidades son enteras y abren teclado numérico', () => {
  assert.match(html, /<input id="profHoyo" type="number" step="1" min="0" inputmode="numeric">/);
  assert.match(html, /<input id="profRaices" type="number" step="1" min="0" inputmode="numeric">/);
});

test('aforo acepta coma en presión, volumen y tiempo', () => {
  assert.ok(!/data-f="presion_(entrada|salida)"[^>]*type="number"/.test(afo), 'presión no debe ser type=number');
  assert.ok(!/data-f="\$\{campo\}"[^>]*type="number"/.test(afo), 'emisores no deben ser type=number');
  assert.match(afo, /const MEDIDOS=new Set\(\['volumen_cc','tiempo_segundos','presion_entrada','presion_salida'\]\)/);
  assert.match(afo, /const valor=MEDIDOS\.has\(f\)\?decimal\(el\.value\):el\.value;/);
});

test('el conversor de calicatas da el número correcto', () => {
  // Se evalúa la función real, copiada del archivo, contra los casos de terreno.
  const src = cal.match(/const aNumero=(v=>\{[^\n]*?\});/)[1];
  const aNumero = eval(src);
  assert.equal(aNumero('28,4'), 28.4);
  assert.equal(aNumero('0,62'), 0.62);
  assert.equal(aNumero('28.4'), 28.4);
  assert.equal(aNumero(' 1,5 '), 1.5);
  assert.equal(aNumero('0'), 0, 'el cero es un valor válido');
  assert.equal(aNumero(''), null);
  assert.ok(Number.isNaN(aNumero('1,2,3')), 'un valor mal escrito no debe pasar como número');
});
