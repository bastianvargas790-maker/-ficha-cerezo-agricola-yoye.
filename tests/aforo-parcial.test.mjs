/* El aforo se llena por partes: en terreno las presiones de las válvulas se
   toman mientras se avanza, y a veces se pasa a tomar solo presiones. El
   formulario ya no obliga a completarlo todo para guardar. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const extraer = nombre => {
  const i = src.indexOf(`function ${nombre}(`);
  assert.ok(i > -1, `no se encontró ${nombre}`);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('llave sin cerrar en ' + nombre);
};
const cuerpo = ['emisoresCompletos', 'faltantes', 'presionesPromedio', 'sectoresDelCuartel', 'validar',
  'emisoresVacios', 'indiceEmisor', 'caudalLh', 'avg', 'calcularResultado'].map(extraer).join('\n');
const api = new Function(`
  const isNum=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v));
  const POSICIONES=['Inicio','1/3','2/3','Último'];
  const LINEAS=['1ª línea','1/3 línea','2/3 línea','Última línea'];
  const TIEMPO_ESTANDAR='36';
  let state=null, sectoresActuales=[];
  ${cuerpo}
  return {faltantes,validar,emisoresCompletos,emisoresVacios,calcularResultado,
    set:s=>{state=s},presionesPromedio};
`)();

const conVolumenes = n => {
  const e = api.emisoresVacios();
  for (let i = 0; i < n; i++) { e[i].volumen_cc = '120'; e[i].tiempo_segundos = '36' }
  return e;
};
const presiones = (ent, sal) => Array.from({ length: 5 }, (_, i) =>
  ({ entrada: ent[i] ?? '', salida: sal[i] ?? '' }));

test('se puede guardar con solo las presiones tomadas', () => {
  api.set({ cuartel_id: 'c1', fecha_evaluacion: '2026-09-29', temporada: 2026, sector: '',
    presiones: presiones(['2.1', '2.0'], ['1.8', '1.7']), emisores: api.emisoresVacios() });
  assert.equal(api.validar(), null, 'no debe exigir emisores');
  assert.deepEqual(api.faltantes(), ['16 de 16 mediciones de emisor']);
});

test('se puede guardar con solo algunos emisores y sin presiones', () => {
  api.set({ cuartel_id: 'c1', fecha_evaluacion: '2026-09-29', temporada: 2026, sector: '',
    presiones: presiones([], []), emisores: conVolumenes(6) });
  assert.equal(api.validar(), null);
  assert.deepEqual(api.faltantes(),
    ['presión de entrada', 'presión de salida', '10 de 16 mediciones de emisor']);
});

test('un aforo completo no reporta faltantes', () => {
  api.set({ cuartel_id: 'c1', fecha_evaluacion: '2026-09-29', temporada: 2026, sector: '',
    presiones: presiones(['2.1'], ['1.8']), emisores: conVolumenes(16) });
  assert.deepEqual(api.faltantes(), []);
});

test('sigue exigiendo lo que la base no admite vacío', () => {
  const base = { presiones: presiones([], []), emisores: api.emisoresVacios(), sector: '' };
  api.set({ ...base, cuartel_id: '', fecha_evaluacion: '2026-09-29', temporada: 2026 });
  assert.match(api.validar(), /Selecciona un cuartel/);
  api.set({ ...base, cuartel_id: 'c1', fecha_evaluacion: '', temporada: 2026 });
  assert.match(api.validar(), /fecha/);
  api.set({ ...base, cuartel_id: 'c1', fecha_evaluacion: '2026-09-29', temporada: '' });
  assert.match(api.validar(), /temporada/);
});

test('el caudal y la uniformidad solo se guardan con las 16 mediciones', () => {
  const guardar = src.slice(src.indexOf('async function guardarAforo'), src.indexOf('async function syncItem'));
  assert.match(guardar, /const hayTodos=completos\.length===16/);
  assert.match(guardar, /const r=hayTodos\?calcularResultado\(state\.emisores\):null/);
  assert.match(guardar, /caudal_promedio:r\?r\.promedio:null/);
  assert.match(guardar, /coeficiente_uniformidad:r\?r\.cu:null/);
  // Las presiones sin medir ya no se guardan como cero.
  assert.match(guardar, /presion_entrada_prom:p\.entrada/);
  assert.ok(!/entrada=p\.entrada\?\?0/.test(guardar), 'una presión sin medir no es cero');
  // Solo viajan las posiciones medidas: la tabla no admite volumen vacío.
  assert.match(guardar, /const mediciones=completos\.map/);
});

test('el formulario es una sola página, sin pasos', () => {
  assert.ok(!/state\.step/.test(src), 'ya no hay pasos');
  assert.ok(!/validarPaso/.test(src), 'la validación por paso desapareció');
  assert.ok(!/yoyeAforoBack/.test(src), 'no queda el botón Atrás');
  assert.match(src, /body\.innerHTML=pasoIdentificacion\(campo,cuartelesActuales\)\+pasoPresiones\(\)\+pasoEmisores\(\)\+pasoResultado\(\)/);
});

test('hay lista de últimos aforos con editar y descartar', () => {
  assert.match(src, /id="yoyeAforoRecientes"/);
  assert.match(src, /data-editar=/);
  assert.match(src, /data-descartar=/);
  assert.match(src, /function editarAforo\(host,campo,id\)/);
  // Descartar es baja lógica, nunca borrado.
  assert.match(src, /update\(\{activo:false,updated_by:session\.user\.id\}\)/);
  assert.match(src, /Incompleto: falta/);
});
