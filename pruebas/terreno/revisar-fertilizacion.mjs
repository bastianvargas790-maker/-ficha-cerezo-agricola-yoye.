/* Revisión en condiciones de terreno del registro de fertilizaciones y del
 * cuartel que se desmarcaba en Calicatas.
 *
 * Las pruebas de tests/ leen el código. Esta abre la app en un teléfono de
 * 390 px, con y sin señal, y hace lo que hace el jefe de riego: elegir el
 * cuartel, anotar los productos, guardar, corregir. Las dos fallas que motivan
 * este archivo no se veían leyendo el archivo: el cuartel se perdía cuando la
 * app recargaba los campos (al volver la señal), no al guardar.
 *
 * Uso:
 *   python3 -m http.server 8899   (desde la raíz del repo)
 *   node pruebas/terreno/revisar-fertilizacion.mjs [http://localhost:8899]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8899';
const fallas = [];
const revisar = (ok, que) => { console.log(`${ok ? '  ok  ' : ' FALLA'}  ${que}`); if (!ok) fallas.push(que) };

const stub = () => {
  const CAMPO = '80aceca7-e61a-441a-b803-d60496a3d36f';
  const CUARTELES = [
    { id: 'q1', codigo: 'C-5',  cuartel: 'C-5',  cultivo: 'Duraznero', variedad: 'Early', superficie_ha: 2.85, campo_id: CAMPO, organizacion_id: 'org1', activo: true },
    { id: 'q2', codigo: 'C-36', cuartel: 'C-36', cultivo: 'Naranjo',   variedad: 'Valencia', superficie_ha: 3.1, campo_id: CAMPO, organizacion_id: 'org1', activo: true }
  ];
  const PRODUCTOS = [
    { id: 'p1', nombre: 'Nitrato de potasio', clave: 'nitrato potasio', unidad: 'kg', activo: true },
    { id: 'p2', nombre: 'Urea', clave: 'urea', unidad: 'kg', activo: true },
    { id: 'p3', nombre: 'Bioamino-L', clave: 'bioamino l', unidad: 'L', activo: true }
  ];
  const PERFIL = [{ id: 'u1', organizacion_id: 'org1', nombre_completo: 'Bastián Vargas', rol: 'administrador' }];
  window.__enviados = [];
  const FILAS = { cuarteles: CUARTELES, perfiles: PERFIL, fert_productos: PRODUCTOS,
    fert_aplicaciones: [], calicatas: [], lecturas_calicata: [], observaciones_calicata: [],
    campos: [], sectores_aforo: [], aforos: [] };
  const tabla = n => { const filas = FILAS[n] || []; const o = {};
    o.select = () => o; ['eq','in','neq','is','not','gte','lte','limit','order'].forEach(m => o[m] = () => o);
    o.then = r => Promise.resolve({ data: filas.slice(), error: null }).then(r);
    o.maybeSingle = () => Promise.resolve({ data: filas[0] || null, error: null });
    o.single = o.maybeSingle;
    o.upsert = rows => { window.__enviados.push({ tabla: n, op: 'upsert', rows }); return Promise.resolve({ data: null, error: null }) };
    o.insert = rows => { window.__enviados.push({ tabla: n, op: 'insert', rows });
      const r = { select: () => r, single: () => Promise.resolve({ data: { id: 'nuevo1' }, error: null }),
        then: f => Promise.resolve({ data: null, error: null }).then(f) }; return r };
    o.update = rows => { window.__enviados.push({ tabla: n, op: 'update', rows }); return o };
    return o };
  const client = { from: tabla, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {}, storage: { from: () => ({}) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) } };
  try { localStorage.setItem('yoye_campo_activo', 'rinconada-plano') } catch {}
  window.__listo = () => dispatchEvent(new CustomEvent('yoye-auth-ready',
    { detail: { client, session: { user: { id: 'u1', email: 'b@y.cl' } } } }));
};

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-CL' });
await ctx.addInitScript(stub);
const p = await ctx.newPage();
const erroresJs = [];
p.on('pageerror', e => erroresJs.push(e.message.slice(0, 160)));

const abrir = async url => {
  await p.goto(`${BASE}/${url}`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { document.querySelector('#sharedAuthScreen')?.remove();
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-granted'); window.__listo?.() });
  await p.waitForTimeout(900);
  await p.evaluate(() => { document.querySelector('#yoyeBienvenida')?.remove();
    document.querySelector('.yoye-sheet-backdrop')?.remove() });
};

console.log(`\nRevisando ${BASE} en un teléfono de 390px\n`);

console.log('— La hoja "Registrar" —');
await abrir('index.html');
await p.evaluate(() => [...document.querySelectorAll('.yoye-nav-item')]
  .find(b => /registrar/i.test(b.textContent))?.click());
await p.waitForTimeout(500);
const hoja = await p.evaluate(() => [...document.querySelectorAll('.yoye-registro-item')]
  .map(b => ({ id: b.dataset.registro, texto: b.textContent.trim() })));
revisar(hoja.length > 0, `la hoja abre con sus opciones (${hoja.map(x => x.id).join(', ')})`);
revisar(!hoja.some(x => x.id === 'riego'), 'ya no ofrece registrar riego');
revisar(hoja.some(x => x.id === 'fertilizacion'), 'ofrece registrar fertilización');
revisar(hoja.some(x => x.id === 'calicata') && hoja.some(x => x.id === 'aforo'), 'calicata y aforo siguen estando');

console.log('\n— Registrar una fertilización —');
await p.evaluate(() => document.querySelector('[data-registro="fertilizacion"]')?.click());
await p.waitForSelector('#yoyeFertModal', { timeout: 8000 });
await p.waitForTimeout(400);
const campos = await p.evaluate(() => ({
  cuarteles: [...document.querySelectorAll('#yoyeFertCab [data-f="cuartel_id"] option')].length - 1,
  productos: [...document.querySelectorAll('[data-c="producto"] option')].map(o => o.textContent),
  filas: document.querySelectorAll('[data-fila]').length,
  fecha: document.querySelector('[data-f="fecha"]').value,
  temporada: document.querySelector('#yoyeFertCab .yoye-hint')?.textContent || ''
}));
revisar(campos.cuarteles === 2, `el selector trae los cuarteles del campo (${campos.cuarteles})`);
revisar(campos.productos.includes('Nitrato de potasio'), 'el catálogo de productos está cargado');
revisar(campos.productos.includes('Otro producto…'), 'se puede escribir un producto que no está en la lista');
revisar(campos.filas >= 2, `arranca con filas listas para escribir (${campos.filas})`);
revisar(!!campos.fecha, `la fecha viene puesta en hoy (${campos.fecha})`);
revisar(/2026-2027|2025-2026/.test(campos.temporada), `dice a qué temporada va (${campos.temporada.trim()})`);

const llenarFila = async (i, producto, cantidad) => {
  await p.evaluate(({ i, producto }) => {
    const row = document.querySelectorAll('[data-fila]')[i];
    const sel = row.querySelector('[data-c="producto"]');
    sel.value = producto; sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, { i, producto });
  await p.waitForTimeout(250);
  await p.evaluate(({ i, cantidad }) => {
    const row = document.querySelectorAll('[data-fila]')[i];
    const c = row.querySelector('[data-c="cantidad"]'); c.value = cantidad;
  }, { i, cantidad });
};
await p.evaluate(() => { const s = document.querySelector('[data-f="cuartel_id"]'); s.value = 'q2'; });
await llenarFila(0, 'p1', '120');
await llenarFila(1, 'p3', '18');
const unidadAuto = await p.evaluate(() =>
  document.querySelectorAll('[data-fila]')[1].querySelector('[data-c="unidad"]').value);
revisar(unidadAuto === 'L', `un producto líquido trae litros puesto solo (quedó "${unidadAuto}")`);

await p.evaluate(() => document.querySelector('#yoyeFertGuardar').click());
await p.waitForTimeout(900);
const trasGuardar = await p.evaluate(() => ({
  estado: document.querySelector('#yoyeFertEstado')?.textContent || '',
  cuartel: document.querySelector('[data-f="cuartel_id"]').value,
  cantidades: [...document.querySelectorAll('[data-c="cantidad"]')].map(i => i.value),
  recientes: [...document.querySelectorAll('.yoye-af-reciente')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
  enviados: window.__enviados
}));
revisar(/guardada/i.test(trasGuardar.estado), `avisa que quedó guardada ("${trasGuardar.estado}")`);
revisar(trasGuardar.cuartel === 'q2', 'el cuartel queda puesto para la siguiente carga');
revisar(trasGuardar.cantidades.every(v => v === ''), 'las cantidades se borran');
revisar(trasGuardar.recientes.length === 1, `la aplicación aparece en "Últimas fertilizaciones" (${trasGuardar.recientes.length})`);
revisar(/C-36/.test(trasGuardar.recientes[0] || ''), 'la tarjeta dice el cuartel');
revisar(/120/.test(trasGuardar.recientes[0] || '') && /18/.test(trasGuardar.recientes[0] || ''), 'la tarjeta dice los productos y sus cantidades');
const subidas = trasGuardar.enviados.filter(e => e.tabla === 'fert_aplicaciones' && e.op === 'upsert');
revisar(subidas.length === 1 && subidas[0].rows.length === 2, `sube las dos filas a fert_aplicaciones (${subidas[0]?.rows.length})`);
const fila = subidas[0]?.rows?.[0] || {};
revisar(fila.cuartel_id === 'q2' && fila.cantidad === 120 && fila.unidad === 'kg',
  `cada fila lleva cuartel, cantidad y unidad (${JSON.stringify({ c: fila.cuartel_id, k: fila.cantidad, u: fila.unidad })})`);
revisar(!('u_n' in fila) && !('via' in fila), 'no se inventan unidades de nutriente ni la vía de aplicación');

console.log('\n— Producto que no está en el catálogo —');
await p.evaluate(() => { const s = document.querySelector('[data-f="cuartel_id"]'); s.value = 'q1' });
await llenarFila(0, 'nuevo', '25');
await p.evaluate(() => { document.querySelector('[data-c="nombre"]').value = 'Nitrato de Potasio ' });
await p.evaluate(() => document.querySelector('#yoyeFertGuardar').click());
await p.waitForTimeout(900);
const nuevos = await p.evaluate(() => window.__enviados.filter(e => e.tabla === 'fert_productos'));
revisar(!nuevos.some(e => e.op === 'insert'),
  'si el nombre escrito ya existe en el catálogo, no se crea un producto repetido');

console.log('\n— Sin señal —');
await ctx.setOffline(true);
await p.evaluate(() => { const s = document.querySelector('[data-f="cuartel_id"]'); s.value = 'q1' });
await llenarFila(0, 'p2', '40');
const antes = await p.evaluate(() => window.__enviados.length);
await p.evaluate(() => document.querySelector('#yoyeFertGuardar').click());
await p.waitForTimeout(900);
const offline = await p.evaluate(a => ({
  estado: document.querySelector('#yoyeFertEstado')?.textContent || '',
  pendiente: !!document.querySelector('.yoye-af-incompleto'),
  nuevosEnvios: window.__enviados.length - a
}), antes);
revisar(offline.nuevosEnvios === 0, 'sin señal no intenta subir');
revisar(/guardad/i.test(offline.estado), `igual queda guardada en el teléfono ("${offline.estado}")`);
revisar(offline.pendiente, 'la lista la marca como pendiente de subir');
await ctx.setOffline(false);

console.log('\n— Corregir y descartar lo registrado —');
await ctx.setOffline(false);
const abrio = await p.evaluate(() => {
  const b = document.querySelector('[data-editar]'); if (!b) return false; b.click(); return true });
revisar(abrio, 'las fertilizaciones registradas traen su botón Editar');
await p.waitForTimeout(500);
const editando = await p.evaluate(() => ({
  aviso: document.querySelector('#yoyeFertEstado')?.textContent || '',
  boton: document.querySelector('#yoyeFertGuardar')?.textContent || '',
  cuartel: document.querySelector('[data-f="cuartel_id"]').value,
  cantidades: [...document.querySelectorAll('[data-c="cantidad"]')].map(i => i.value)
}));
revisar(/Editando/.test(editando.aviso), `dice qué se está corrigiendo ("${editando.aviso}")`);
revisar(editando.boton === 'Guardar cambios', `el botón cambia a "${editando.boton}"`);
revisar(editando.cantidades.some(v => v !== ''), `vuelven las cantidades al formulario (${editando.cantidades.join(', ')})`);
await p.evaluate(() => { document.querySelector('[data-c="cantidad"]').value = '95' });
await p.evaluate(() => document.querySelector('#yoyeFertGuardar').click());
await p.waitForTimeout(900);
const corregido = await p.evaluate(() => ({
  aviso: document.querySelector('#yoyeFertEstado')?.textContent || '',
  boton: document.querySelector('#yoyeFertGuardar')?.textContent || '',
  lista: [...document.querySelectorAll('.yoye-af-reciente')].map(x => x.textContent.replace(/\s+/g, ' ')).join(' | ')
}));
revisar(/Cambios guardados/.test(corregido.aviso), `avisa que se corrigió ("${corregido.aviso}")`);
revisar(corregido.boton === 'Guardar fertilización', 'el botón vuelve a su texto normal');
revisar(/95/.test(corregido.lista), 'la lista muestra la cantidad corregida');

const antesDeDescartar = await p.evaluate(() => ({
  n: document.querySelectorAll('.yoye-af-reciente').length,
  primera: document.querySelector('.yoye-af-reciente strong')?.textContent || '' }));
p.once('dialog', d => d.accept());
const descarto = await p.evaluate(() => {
  const b = document.querySelector('[data-descartar]'); if (!b) return false; b.click(); return true });
await p.waitForTimeout(900);
const quedan = await p.evaluate(() => ({
  n: document.querySelectorAll('.yoye-af-reciente').length,
  textos: [...document.querySelectorAll('.yoye-af-reciente strong')].map(x => x.textContent) }));
revisar(descarto, 'hay botón Descartar');
revisar(quedan.n === antesDeDescartar.n - 1, `sale de la lista la que se descartó, y sólo esa (de ${antesDeDescartar.n} a ${quedan.n})`);
revisar(!quedan.textos.includes(antesDeDescartar.primera), `ya no aparece "${antesDeDescartar.primera}"`);
// Dos cargas del mismo cuartel el mismo día son UNA tarjeta, no dos.
revisar(new Set(quedan.textos).size === quedan.textos.length, 'no quedan tarjetas repetidas del mismo cuartel y día');
const bajas = await p.evaluate(() => window.__enviados.filter(e => e.tabla === 'fert_aplicaciones' && e.op === 'update'));
revisar(bajas.every(b => b.rows.activo === false), 'descartar oculta con activo=false, no borra');

console.log('\n— El cuartel de la calicata no se desmarca —');
await abrir('calicatas/registro-v16.html');
await p.waitForTimeout(600);
const elegido = await p.evaluate(() => {
  const s = document.querySelector('#cuartelId');
  s.value = s.options[1]?.value; s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
});
await p.fill('#horasRiego', '24');
// Esto es lo que pasaba en terreno: vuelve la señal, la app recarga los campos
// y el formulario se repinta debajo de lo que estabas escribiendo.
await p.evaluate(() => document.dispatchEvent(new CustomEvent('yoye-campo-ready')));
await p.waitForTimeout(800);
await p.evaluate(() => dispatchEvent(new Event('online')));
await p.waitForTimeout(800);
const despues = await p.evaluate(() => ({
  cuartel: document.querySelector('#cuartelId').value,
  horas: document.querySelector('#horasRiego').value,
  opciones: document.querySelector('#cuartelId').options.length
}));
revisar(!!elegido, 'se puede elegir un cuartel');
revisar(despues.cuartel === elegido, `el cuartel sigue elegido después de que la app recarga los campos (quedó "${despues.cuartel}")`);
revisar(despues.horas === '24', 'lo que ya estaba escrito no se pierde');
revisar(despues.opciones > 1, 'la lista de cuarteles sigue completa');

revisar(!erroresJs.length, 'sin errores de JavaScript' + (erroresJs.length ? ': ' + erroresJs.join(' · ') : ''));

await navegador.close();
console.log(fallas.length ? `\n${fallas.length} falla(s)` : '\nTodo pasa');
process.exit(fallas.length ? 1 : 0);
