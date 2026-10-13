/* Retratos de los paneles: abre cada uno con datos de prueba y guarda una
 * imagen, en escritorio y en teléfono. No comprueba nada — sirve para MIRAR,
 * que es el paso que ninguna prueba reemplaza.
 *
 *   python3 -m http.server 8899
 *   node pruebas/paneles/retratos.mjs [carpeta]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8899';
const SALIDA = process.argv[2] || (new URL('.', import.meta.url).pathname + 'capturas');

const stub = () => {
  const CAMPO = '80aceca7-e61a-441a-b803-d60496a3d36f';
  const CAMPOS = [
    { id: CAMPO, slug: 'rinconada-plano', nombre: 'Rinconada Plano', superficie_ha: 78.44, orden: 1 },
    { id: 'c2', slug: 'rinconada-cerro', nombre: 'Rinconada Cerro', superficie_ha: 41.2, orden: 2 },
    { id: 'c3', slug: 'mirador-plano', nombre: 'Mirador Plano', superficie_ha: 56.9, orden: 3 },
    { id: 'c4', slug: 'mirador-cerro', nombre: 'Mirador Cerro', superficie_ha: 33.5, orden: 4 }];
  const COD = ['C-5', 'C-12', 'C-26', 'C-30', 'C-34', 'C-39', 'C-41'];
  const CUARTELES = COD.map((codigo, i) => ({ id: 'q' + i, codigo, cuartel: codigo,
    cultivo: i % 2 ? 'Ciruelo' : 'Cerezo', variedad: 'Santina', caseta: 'Caseta ' + (1 + i % 2),
    equipo: 'E' + (1 + i % 3), superficie_ha: 2 + i / 10, campo_id: CAMPO, organizacion_id: 'org1', activo: true }));
  const FECHAS = ['2026-08-10', '2026-08-28', '2026-09-14', '2026-09-28'];
  const CAL = [], LECT = [], OBS = [];
  CUARTELES.forEach((q, i) => {
    const fechas = i === COD.length - 1 ? FECHAS.slice(0, 1) : FECHAS.slice(i % 2);
    fechas.forEach((f, j) => {
      const id = `${q.id}-${j}`;
      CAL.push({ id, cuartel_id: q.id, fecha: f, hora: '09:3' + j, horas_desde_ultimo_riego: 12,
        duracion_ultimo_riego_h: 4, profundidad_hoyo_cm: 90, profundidad_efectiva_raices_cm: 60,
        union_bulbos: j % 2 ? 'unidos' : 'parcialmente_unidos', responsable: 'Bastián Vargas',
        activo: true, observaciones_generales: '' });
      OBS.push({ calicata_id: id, categoria: 'horizontes', opcion_codigo: 'franco', opcion_etiqueta: 'Franco' });
      OBS.push({ calicata_id: id, categoria: 'raices', opcion_codigo: 'abundantes', opcion_etiqueta: 'Raíces abundantes' });
      [30, 60, 90].forEach(d => ['punto_cero', 'linea_izquierda', 'linea_derecha'].forEach((perfil, k) => {
        LECT.push({ calicata_id: id, perfil, profundidad_cm: d, estado: 'medida',
          humedad_pct: 27 - i * 1.4 - j * 1.1 - (d - 30) / 30 * 2.2 + k * 0.8,
          ce_ms_cm: 0.5 + i * 0.07 + j * 0.12 + (d - 30) / 30 * 0.18, temperatura_c: 17 + j * 0.6 });
      }));
    });
  });
  const SECTORES = CUARTELES.map((q, i) => ({ id: 's' + i, cuartel_id: q.id, campo_id: CAMPO,
    codigo: q.codigo.replace('C-', ''), nombre: q.codigo, orden: i, activo: true }));
  const AFOROS = CUARTELES.slice(0, 5).map((q, i) => ({ id: 'a' + i, cuartel_id: q.id, sector_aforo_id: 's' + i,
    sector: q.codigo.replace('C-', ''), equipo_riego: 'Equipo de riego', temporada: 2025,
    fecha_evaluacion: '2025-1' + (i % 2) + '-0' + (1 + i), evaluador_nombre: 'Planilla temporada 2025',
    cantidad_valvulas: 1, presion_entrada_prom: 1 + i / 10, presiones_entrada: [1 + i / 10], presiones_salida: [],
    caudal_promedio: 2.2 + i * 0.3, caudal_25: 2 + i * 0.25, coeficiente_uniformidad: 94 - i * 6,
    clasificacion: i < 2 ? 'Excelente' : i < 4 ? 'Bueno' : 'Bajo', activo: true, observaciones: 'Se reguló presión' }));
  const MED = AFOROS.flatMap(a => Array.from({ length: 16 }, (_, k) => ({ id: a.id + '-m' + k, aforo_id: a.id,
    posicion: ['Inicio', '1/3', '2/3', 'Último'][Math.floor(k / 4)], linea: ['1ª línea', '1/3 línea', '2/3 línea', 'Última línea'][k % 4],
    indice: k + 1, volumen_cc: 22 + (k % 5), tiempo_segundos: 36, caudal_l_h: (22 + (k % 5)) / 10 })));
  const ACIDO = CUARTELES.map((q, i) => ({ id_registro: 'AP-2026-00' + (i + 1), campo_id: CAMPO,
    caseta: i % 2 ? 'Nueva' : 'Vieja', equipo: String(1 + i % 4), cuartel_codigo: q.codigo, variedad: 'Santina',
    superficie_ha: 2 + i / 10, fecha_aplicacion: i < 4 ? '2026-08-1' + i : null,
    estado_aplicacion: i < 4 ? 'Aplicado' : 'Pendiente', fecha_descole: i < 3 ? '2026-08-2' + i : null,
    estado_descole: i < 5 ? 'Descolado' : 'Sin aplicación', dosis_l_ha: 10,
    litros_requeridos: (2 + i / 10) * 10, litros_aplicados: i < 4 ? (2 + i / 10) * 10 : 0,
    litros_pendientes: i < 4 ? 0 : (2 + i / 10) * 10, actualizado_en: '2026-10-13T12:00:00Z' }));
  const FILAS = { cuarteles: CUARTELES, calicatas: CAL, lecturas_calicata: LECT, observaciones_calicata: OBS,
    campos: CAMPOS, sectores_aforo: SECTORES, aforos: AFOROS, mediciones_aforo: MED, aplicaciones_acido: ACIDO,
    perfiles: [{ id: 'u1', organizacion_id: 'org1', nombre_completo: 'Bastián Vargas', rol: 'administrador' }],
    fert_productos: [], fert_programa_estado: [], fert_aplicaciones: [] };
  const tabla = n => { const filas = FILAS[n] || []; const o = {};
    o.select = () => o; ['eq','in','neq','is','not','gte','lte','limit','order'].forEach(m => o[m] = () => o);
    o.then = r => Promise.resolve({ data: filas.slice(), error: null }).then(r);
    o.maybeSingle = () => Promise.resolve({ data: filas[0] || null, error: null }); o.single = o.maybeSingle;
    o.upsert = () => Promise.resolve({ data: null, error: null }); o.update = () => o; o.insert = () => o;
    return o };
  const client = { from: tabla, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {}, storage: { from: () => ({}) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) } };
  window.yoyeCampos = CAMPOS;
  window.yoyeActiveCampo = () => ({ id: CAMPO, nombre: 'Rinconada Plano', slug: 'rinconada-plano' });
  try { localStorage.setItem('yoye_campo_activo', 'rinconada-plano') } catch {}
  addEventListener('DOMContentLoaded', () => setTimeout(() => dispatchEvent(new CustomEvent('yoye-auth-ready',
    { detail: { client, session: { user: { id: 'u1', email: 'b@y.cl' } } } })), 30));
};

const PANELES = [
  ['campos',            '#panel-campos',            'Todos los campos'],
  ['calicatas-lista',   '#panel-calicatas',         'Calicatas · vista de todos los cuarteles'],
  ['calicatas-cuartel', '#panel-calicatas:C-5',     'Calicatas · ficha de un cuartel'],
  ['aforos',            '#panel-aforos',            'Aforos'],
  ['acido',             '#panel-acido',             'Ácido peracético'],
  ['descoles',          '#panel-descoles',          'Descole'],
  ['fertilizacion',     '#panel-fertilizacion',     'Fertilización'],
];

mkdirSync(SALIDA, { recursive: true });
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const [tam, w, h] of [['pc', 1440, 1000], ['movil', 390, 844]]) {
  const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'es-CL', deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  for (const [nombre, hash, titulo] of PANELES) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    await p.goto(`${BASE}/paneles/${hash}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.pd-cuerpo', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(900);
    await p.evaluate(() => { document.querySelector('#sharedAuthScreen')?.remove();
      document.querySelector('.yoye-bottom-nav')?.remove() });
    const el = await p.$('#yoyePanelVista');
    if (el) await el.screenshot({ path: `${SALIDA}/${tam}-${nombre}.png` });
    const alto = await p.evaluate(() => document.querySelector('#yoyePanelVista')?.scrollHeight || 0);
    console.log(`${tam.padEnd(6)} ${nombre.padEnd(20)} ${String(alto).padStart(5)}px  ${titulo}${errs.length ? '  ⚠ ' + errs[0] : ''}`);
    await p.close();
  }
  await ctx.close();
}
await nav.close();
console.log(`\nImágenes en ${SALIDA}`);
