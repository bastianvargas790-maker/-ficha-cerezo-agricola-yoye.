/* Revisión en condiciones de terreno, no de escritorio.
 *
 * Las pruebas de tests/ leen el código; esta abre la app de verdad en un
 * navegador de 390px con las capacidades que tiene un teléfono y que un
 * Chromium de escritorio NO tiene por defecto. Ahí se escondieron dos fallas
 * que llegaron publicadas: el botón "Compartir" (aparece solo si existe
 * navigator.share, que en el escritorio no existe) y el mensaje recortado,
 * que en pantalla chica no se notaba.
 *
 * Uso:
 *   python3 -m http.server 8899   (desde la raíz del repo)
 *   node pruebas/terreno/revisar-en-telefono.mjs [http://localhost:8899]
 *
 * Devuelve 0 si todo pasa, 1 si algo falla.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8899';
const fallas = [];
const revisar = (ok, que) => { console.log(`${ok ? '  ok  ' : ' FALLA'}  ${que}`); if (!ok) fallas.push(que) };

const stub = () => {
  // Un teléfono SÍ tiene navigator.share. El escritorio no: por eso el botón
  // de compartir nunca aparecía en las pruebas y sí en terreno.
  try { Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true }) } catch {}
  const CUARTELES = [{ id: 'q1', codigo: 'C-5', cuartel: 'C-5', cultivo: 'Duraznero', variedad: 'Early Blush',
    superficie_ha: 2.85, campo_id: '80aceca7-e61a-441a-b803-d60496a3d36f', activo: true }];
  const PERFIL = [{ id: 'u1', organizacion_id: 'org1', nombre_completo: 'Bastián Vargas', rol: 'administrador' }];
  const CAL = [{ id: 'cal1', client_uuid: 'cal1', cuartel_id: 'q1', fecha: '2026-09-20', hora: '09:00',
    horas_desde_ultimo_riego: 12, duracion_ultimo_riego_h: 4, profundidad_hoyo_cm: 90,
    profundidad_efectiva_raices_cm: 60, union_bulbos: 'unidos', responsable: 'Bastián Vargas',
    creado_por: 'u1', creado_en: '2026-09-20T09:00:00Z' }];
  const LECT = [30, 60, 90].flatMap(d => ['punto_cero', 'linea_izquierda', 'linea_derecha'].map((perfil, i) => ({
    id: `l${d}${i}`, client_uuid: `l${d}${i}`, calicata_id: 'cal1', perfil, profundidad_cm: d,
    humedad_pct: 20 + i, ce_ms_cm: 0.6, temperatura_c: 18, estado: 'medida', creado_por: 'u1' })));
  const tabla = n => {
    const filas = { cuarteles: CUARTELES, perfiles: PERFIL, calicatas: CAL, lecturas_calicata: LECT }[n] || [];
    const o = {};
    o.select = () => o; o.eq = () => o; o.in = () => o; o.neq = () => o;
    ['is', 'not', 'gte', 'lte', 'limit', 'order'].forEach(m => o[m] = () => o);
    o.then = r => Promise.resolve({ data: filas.slice(), error: null }).then(r);
    o.maybeSingle = () => Promise.resolve({ data: filas[0] || null, error: null }); o.single = o.maybeSingle;
    o.upsert = () => Promise.resolve({ data: null, error: null }); o.update = () => o; o.delete = () => o;
    return o;
  };
  const client = { from: tabla, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {}, storage: { from: () => ({}) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) } };
  window.__listo = () => dispatchEvent(new CustomEvent('yoye-auth-ready',
    { detail: { client, session: { user: { id: 'u1', email: 'b@y.cl' } } } }));
};

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-CL' });
await ctx.addInitScript(stub);
const p = await ctx.newPage();
const erroresJs = [];
p.on('pageerror', e => erroresJs.push(e.message.slice(0, 140)));

const abrir = async () => {
  await p.goto(`${BASE}/calicatas/registro-v16.html`, { waitUntil: 'networkidle' });
  await p.evaluate(() => { document.querySelector('#sharedAuthScreen')?.remove();
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-granted'); window.__listo?.() });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('#yoyeBienvenida')?.remove());
};
const llenar = async h => {
  await p.selectOption('#cuartelId', await p.$eval('#cuartelId', s => s.options[1]?.value));
  await p.fill('#fecha', new Date().toISOString().slice(0, 10));
  await p.selectOption('#unionBulbos', 'unidos');
  await p.evaluate(h => {
    const c = [...document.querySelectorAll('.depth-block input')];
    c.slice(0, 9).forEach((el, i) => { el.value = [h, 0.6, 18][i % 3]; el.dispatchEvent(new Event('input', { bubbles: true })) });
  }, h);
};
const aviso = () => p.evaluate(() => {
  const b = document.querySelector('#calGuardada'), pre = document.querySelector('#calMensaje');
  const cs = pre ? getComputedStyle(pre) : null;
  return { visible: b && !b.hidden,
    titulo: b?.querySelector('.guardada-titulo')?.textContent || '',
    detalle: b?.querySelector('.guardada-detalle')?.textContent || '',
    mensaje: (pre?.textContent || '').length,
    alto: pre ? Math.round(pre.getBoundingClientRect().height) : 0,
    recortado: cs ? cs.maxHeight !== 'none' : null,
    seleccionable: cs?.userSelect,
    botones: [...document.querySelectorAll('.guardada-acciones button')].filter(x => !x.hidden).map(x => x.textContent.trim()),
    anchoDeMas: document.documentElement.scrollWidth - window.innerWidth };
});

console.log(`\nRevisando ${BASE} en un teléfono de 390px, con navigator.share presente\n`);

console.log('— Guardar una calicata nueva —');
await abrir(); await llenar(22);
await p.click('#saveCalicata'); await p.waitForTimeout(2200);
let a = await aviso();
revisar(a.visible, 'el aviso de guardado aparece');
revisar(a.titulo.includes('guardada'), `el aviso trae título (dice: "${a.titulo}")`);
revisar(a.mensaje > 200, `el mensaje para el grupo está escrito (${a.mensaje} caracteres)`);
revisar(!a.recortado, 'el mensaje se muestra entero, sin recorte');
revisar(a.seleccionable === 'text', 'el mensaje se puede seleccionar con el dedo');
revisar(!a.botones.some(b => /compartir/i.test(b)), `no hay botón de compartir (botones: ${a.botones.join(', ')})`);
revisar(a.botones.some(b => /copiar/i.test(b)), 'está el botón de copiar');
revisar(a.anchoDeMas <= 2, `la pantalla no se sale a lo ancho (${a.anchoDeMas}px de más)`);

console.log('\n— Corregir una calicata ya guardada —');
await p.evaluate(() => document.querySelector('#calCerrarGuardada')?.click());
const editable = await p.evaluate(() => { const b = document.querySelector('[data-edit-calicata]'); if (b) { b.click(); return true } return false });
revisar(editable, 'la calicata aparece en “Últimas calicatas” con su botón Editar');
if (editable) {
  await p.waitForTimeout(900);
  const lecturas = await p.evaluate(() => [...document.querySelectorAll('.depth-block input')].filter(i => i.value !== '').length);
  revisar(lecturas === 27, `al editar vuelven las 27 lecturas al formulario (volvieron ${lecturas})`);
  await p.evaluate(() => { const c = document.querySelector('.depth-block input'); c.value = '31'; c.dispatchEvent(new Event('input', { bubbles: true })) });
  await p.click('#saveCalicata'); await p.waitForTimeout(2200);
  a = await aviso();
  revisar(a.titulo.includes('actualizada'), `el aviso dice que se actualizó (dice: "${a.titulo}")`);
  revisar(a.mensaje > 200, 'vuelve a salir el mensaje, con los datos corregidos');
}

console.log('\n— Guardar sin señal, como en terreno —');
await abrir(); await llenar(24);
await ctx.setOffline(true);
await p.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); dispatchEvent(new Event('offline')) });
const t0 = Date.now();
await p.click('#saveCalicata');
await p.waitForFunction(() => !document.querySelector('#calGuardada').hidden, { timeout: 8000 }).catch(() => {});
const demora = Date.now() - t0;
a = await aviso();
revisar(a.visible, 'el aviso aparece aunque no haya señal');
revisar(demora < 3000, `el aviso no hace esperar a la subida (${demora} ms)`);
revisar(a.mensaje > 200, 'el mensaje está escrito igual, sin conexión');
revisar(/recuperar señal/.test(a.detalle), 'avisa que se enviará sola al recuperar señal');
await ctx.setOffline(false);

revisar(erroresJs.length === 0, `no hay errores de JavaScript${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);

await navegador.close();
console.log(fallas.length ? `\n${fallas.length} falla(s).\n` : '\nTodo en orden.\n');
process.exit(fallas.length ? 1 : 0);
