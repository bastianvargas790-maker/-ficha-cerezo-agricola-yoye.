/* Prueba del selector de sector del wizard de Aforo.
   Extrae las funciones reales de assets/aforo.js (no una copia) y las corre
   con las listas de sectores que hoy tiene la base, campo por campo. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const extraer = nombre => {
  const i = src.indexOf(`function ${nombre}(`);
  assert.ok(i > -1, `no se encontró ${nombre}`);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('llave sin cerrar en ' + nombre);
};

const cuerpo = ['campoSector', 'sectoresDelCuartel', 'sectorElegido', 'validarPaso']
  .map(extraer).join('\n');
const fabricar = new Function(`
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isNum=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v));
  let state=null, sectoresActuales=[];
  ${cuerpo}
  return (s,sec)=>{state=s;sectoresActuales=sec;
    return {html:campoSector(),elegido:sectorElegido(),error:validarPaso()}};
`)();

const base = { step: 0, fecha_evaluacion: '2026-09-04', temporada: 2026, sector: '' };
const sect = (cuartel_id, codigo, nombre) => ({ id: 'id-' + codigo, cuartel_id, codigo, nombre: nombre || 'Sector ' + codigo });

test('cuartel con un solo sector: no pregunta y lo resuelve solo', () => {
  const sectores = [sect('c-36', '36')];
  const r = fabricar({ ...base, cuartel_id: 'c-36' }, sectores);
  assert.equal(r.html, '');
  assert.equal(r.elegido.codigo, '36');
  assert.equal(r.error, null);
});

test('cuartel partido: pregunta, exige respuesta y manda el código de la planilla', () => {
  const sectores = [sect('c-40', '40 A'), sect('c-40', '40B')];
  const sinElegir = fabricar({ ...base, cuartel_id: 'c-40' }, sectores);
  assert.match(sinElegir.html, /Sector de aforo \*/);
  assert.match(sinElegir.html, /value="40 A"/);
  assert.match(sinElegir.html, /value="40B"/);
  assert.equal(sinElegir.elegido, null);
  assert.match(sinElegir.error, /más de un sector/);

  const elegido = fabricar({ ...base, cuartel_id: 'c-40', sector: '40B' }, sectores);
  assert.equal(elegido.elegido.codigo, '40B');
  assert.equal(elegido.elegido.id, 'id-40B');
  assert.equal(elegido.error, null);
});

test('solo se ofrecen los sectores del cuartel elegido', () => {
  const sectores = [sect('c-20', '18'), sect('c-20', '20'), sect('c-30', '30'), sect('c-30', '32')];
  const r = fabricar({ ...base, cuartel_id: 'c-20' }, sectores);
  assert.match(r.html, /value="18"/);
  assert.match(r.html, /value="20"/);
  assert.doesNotMatch(r.html, /value="32"/);
});

test('sin sectores cargados el campo sigue siendo texto libre y no bloquea', () => {
  const r = fabricar({ ...base, cuartel_id: 'c-x' }, []);
  assert.match(r.html, /input data-f="sector"/);
  assert.equal(r.error, null);
});

test('sin cuartel elegido no se muestra sector y el error es el del cuartel', () => {
  const r = fabricar({ ...base, cuartel_id: '' }, [sect('c-40', '40 A'), sect('c-40', '40B')]);
  assert.equal(r.html, '');
  assert.match(r.error, /Selecciona un cuartel/);
});
