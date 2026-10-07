/* Revisión del resumen de tendencias del panel de Calicatas, mirando el dibujo.
 *
 * Las pruebas de tests/ leen el código; esta abre el panel de verdad en un
 * navegador, con datos de varios cuarteles y varias fechas, y mide el dibujo:
 * que el SVG se arme al ancho de la tarjeta (y no estirado), que no se escape
 * de la pantalla, que los rótulos del eje no se pisen y que cada serie lleve su
 * nombre. Deja además una captura de cada tamaño para mirarla.
 *
 * Uso:
 *   python3 -m http.server 8899   (desde la raíz del repo)
 *   node pruebas/paneles/revisar-tendencias.mjs [http://localhost:8899]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8899';
const SALIDA = new URL('.', import.meta.url).pathname + 'capturas';
const fallas = [];
const revisar = (ok, que) => { console.log(`${ok ? '  ok  ' : ' FALLA'}  ${que}`); if (!ok) fallas.push(que) };

const stub = () => {
  const CAMPO = '80aceca7-e61a-441a-b803-d60496a3d36f';
  const CODIGOS = ['C-5', 'C-12', 'C-26', 'C-30', 'C-34', 'C-39', 'C-41'];
  const FECHAS = ['2026-08-10', '2026-08-28', '2026-09-14', '2026-09-28'];
  const CUARTELES = CODIGOS.map((codigo, i) => ({ id: 'q' + i, codigo, cuartel: codigo,
    cultivo: i % 2 ? 'Ciruelo' : 'Duraznero', variedad: 'DAgen', caseta: 'Caseta ' + (1 + i % 2),
    equipo: 'E' + (1 + i % 3), superficie_ha: 2 + i / 10, campo_id: CAMPO, activo: true }));
  const CAL = [], LECT = [], OBS = [];
  CUARTELES.forEach((q, i) => {
    // El último cuartel queda con una sola fecha: así se prueba que no se
    // dibuja una línea de un punto.
    const fechas = i === CODIGOS.length - 1 ? FECHAS.slice(0, 1) : FECHAS.slice(i % 2);
    fechas.forEach((f, j) => {
      const id = `${q.id}-${j}`;
      CAL.push({ id, client_uuid: id, cuartel_id: q.id, fecha: f, hora: '09:3' + j,
        horas_desde_ultimo_riego: 12, duracion_ultimo_riego_h: 4, profundidad_hoyo_cm: 90,
        profundidad_efectiva_raices_cm: 60, union_bulbos: j % 2 ? 'unidos' : 'parcialmente_unidos',
        responsable: 'Bastián Vargas', activo: true, observaciones_generales: '' });
      OBS.push({ calicata_id: id, categoria: 'horizontes', opcion_codigo: 'franco',
        opcion_etiqueta: 'Franco', perfil: null, profundidad_cm: null });
      [30, 60, 90].forEach(d => ['punto_cero', 'linea_izquierda', 'linea_derecha'].forEach((perfil, k) => {
        LECT.push({ calicata_id: id, perfil, profundidad_cm: d, estado: 'medida',
          humedad_pct: 27 - i * 1.4 - j * 1.1 - (d - 30) / 30 * 2.2 + k * 0.8,
          ce_ms_cm: 0.5 + i * 0.07 + j * 0.12 + (d - 30) / 30 * 0.18,
          temperatura_c: 17 + j * 0.6 });
      }));
    });
  });
  const FILAS = { cuarteles: CUARTELES, calicatas: CAL, lecturas_calicata: LECT, observaciones_calicata: OBS };
  const tabla = n => { const filas = FILAS[n] || []; const o = {};
    o.select = () => o; ['eq','in','neq','is','not','gte','lte','limit','order'].forEach(m => o[m] = () => o);
    o.then = r => Promise.resolve({ data: filas.slice(), error: null }).then(r);
    o.maybeSingle = () => Promise.resolve({ data: filas[0] || null, error: null }); o.single = o.maybeSingle;
    return o };
  const client = { from: tabla, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {}, storage: { from: () => ({}) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) } };
  window.yoyeActiveCampo = () => ({ id: CAMPO, nombre: 'Rinconada Plano', slug: 'rinconada-plano' });
  // Sin campo elegido, campos.js tapa la pantalla con "Elige el campo".
  try { localStorage.setItem('yoye_campo_activo', 'rinconada-plano') } catch {}
  addEventListener('DOMContentLoaded', () => setTimeout(() =>
    dispatchEvent(new CustomEvent('yoye-auth-ready', { detail: { client, session: { user: { id: 'u1' } } } })), 30));
};

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const erroresJs = [];

async function mirar(nombre, ancho, alto, hash) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, locale: 'es-CL' });
  await ctx.addInitScript(stub);
  const p = await ctx.newPage();
  p.on('pageerror', e => erroresJs.push(`${nombre}: ${e.message.slice(0, 160)}`));
  await p.goto(`${BASE}/paneles/${hash}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pd-grafico', { timeout: 15000 });
  await p.waitForTimeout(400);
  const datos = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.pd-grafico')].map(c => {
      const svg = c.querySelector('svg'), r = svg.getBoundingClientRect();
      const vb = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
      const ejes = [...svg.querySelectorAll('text.pd-svg-eje')].map(t => {
        const b = t.getBoundingClientRect(); return { t: t.textContent, x0: b.left, x1: b.right, y: b.top } });
      return { titulo: c.querySelector('.pd-card-title').textContent.trim(),
        vbW: vb[2], vbH: vb[3], anchoReal: Math.round(r.width), altoReal: Math.round(r.height),
        series: [...svg.querySelectorAll('text.pd-svg-serie')].map(t => t.textContent),
        leyenda: [...c.querySelectorAll('.pd-leyenda-item')].map(t => t.textContent.trim()),
        ref: [...svg.querySelectorAll('text.pd-svg-ref')].map(t => t.textContent),
        lineas: svg.querySelectorAll('path[stroke-width="2"]').length,
        ejesX: ejes.filter(e => /\d\/\d/.test(e.t)) };
    });
    /* El ancho se mide sobre el panel, no sobre el documento: la pantalla de
       acceso deja su logo sin estilar detrás y ese desborde no es del panel. */
    const cuerpo=document.querySelector('.pd-cuerpo');
    const borde=Math.max(...[...cuerpo.querySelectorAll('*')]
      .filter(e=>!e.closest('.pd-tabla-wrap'))      // las tablas tienen su propio desplazamiento
      .map(e=>e.getBoundingClientRect().right));
    return { cards, scrollW: Math.round(borde), clientW: document.documentElement.clientWidth,
      textos: [...document.querySelectorAll('.pd-card-title')].map(t => t.textContent.trim()) };
  });
  await p.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: true });
  await ctx.close();
  return datos;
}

/* --- Vista de la selección: el resumen de tendencias --- */
const sel = await mirar('seleccion-pc', 1440, 1200, '#panel-calicatas');
const selMovil = await mirar('seleccion-movil', 390, 844, '#panel-calicatas');
const ficha = await mirar('ficha-pc', 1440, 1200, '#panel-calicatas:C-5');
const fichaMovil = await mirar('ficha-movil', 390, 844, '#panel-calicatas:C-5');

const tendencias = d => d.cards.filter(c => /fecha a fecha/.test(c.titulo));
for (const [nombre, d, maxLineas] of [['pc', sel, 5], ['móvil', selMovil, 5]]) {
  const t = tendencias(d);
  revisar(t.length === 2, `${nombre}: están los dos gráficos de tendencia (humedad y CE) y no uno con dos ejes`);
  revisar(t.every(c => c.lineas >= 2 && c.lineas <= maxLineas), `${nombre}: entre 2 y ${maxLineas} líneas por gráfico (${t.map(c => c.lineas)})`);
  revisar(t.every(c => c.leyenda.length === c.lineas), `${nombre}: la leyenda nombra todas las series`);
  revisar(d.scrollW <= d.clientW + 1, `${nombre}: nada del panel se sale de la pantalla (${d.scrollW} ≤ ${d.clientW})`);
  // Rótulos del eje de fechas: ninguno encima de otro.
  t.forEach(c => {
    const porFila = {};
    c.ejesX.forEach(e => { (porFila[Math.round(e.y)] ||= []).push(e) });
    const choca = Object.values(porFila).some(fila => fila.sort((a, b) => a.x0 - b.x0)
      .some((e, i, a) => i && e.x0 < a[i - 1].x1 + 2));
    revisar(!choca, `${nombre}: los rótulos de fecha no se pisan en «${c.titulo.slice(0, 34)}…»`);
  });
}
/* El dibujo de tendencia se arma al ancho real de la tarjeta: nada de estirar un
   SVG de 360 px hasta el ancho del escritorio, que es lo que agrandaba el texto
   del eje tres veces. (Los perfiles por profundidad siguen escalando: son
   tarjetas chicas, de a tres por fila.) */
for (const [nombre, d] of [['pc', sel], ['móvil', selMovil], ['ficha pc', ficha], ['ficha móvil', fichaMovil]])
  d.cards.filter(c => c.vbW && /fecha/.test(c.titulo)).forEach(c => revisar(Math.abs(c.vbW - c.anchoReal) <= 12,
    `${nombre}: «${c.titulo.slice(0, 30)}…» se dibuja 1:1 (viewBox ${c.vbW} vs ${c.anchoReal} px en pantalla)`));
revisar(tendencias(sel).every(c => c.vbH >= 330), `pc: los gráficos van grandes (alto ${tendencias(sel).map(c => c.vbH)})`);
revisar(tendencias(selMovil).every(c => c.vbH <= 290), `móvil: tamaño normal (alto ${tendencias(selMovil).map(c => c.vbH)})`);
revisar(tendencias(sel)[0].series.length === tendencias(sel)[0].lineas,
  'pc: cada línea lleva su cuartel y su último valor escrito al borde');
revisar(tendencias(selMovil)[0].series.length === 0, 'móvil: sin nombres al borde, que no caben; la leyenda los lleva');
revisar(tendencias(sel)[0].ref.some(t => /suelo medio/.test(t)),
  'pc: la referencia del suelo aparece cuando todos los cuarteles tienen la misma textura');
revisar(sel.textos.includes('Evolución por fecha'), 'la tabla con los mismos datos acompaña a los gráficos');
revisar(ficha.cards.some(c => /Humedad por fecha/.test(c.titulo)) && ficha.cards.some(c => /CE por fecha/.test(c.titulo)),
  'la ficha del cuartel conserva su evolución por profundidad');
revisar(!erroresJs.length, 'sin errores de JavaScript' + (erroresJs.length ? ': ' + erroresJs.join(' · ') : ''));

/* --- Girar el teléfono: el dibujo se rehace al ancho nuevo --- */
{
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-CL' });
  await ctx.addInitScript(stub);
  const p = await ctx.newPage();
  p.on('pageerror', e => erroresJs.push('giro: ' + e.message.slice(0, 160)));
  await p.goto(`${BASE}/paneles/#panel-calicatas`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pd-grafico', { timeout: 15000 });
  const vb = () => p.$eval('.pd-grafico svg', s => Number((s.getAttribute('viewBox') || '').split(' ')[2]));
  const antes = await vb();
  await p.setViewportSize({ width: 1024, height: 768 });
  await p.waitForTimeout(700);
  const despues = await vb();
  revisar(antes < 400 && despues > 800, `al girar o agrandar la ventana el gráfico se rehace (${antes} → ${despues} px)`);
  await ctx.close();
}

await navegador.close();
console.log(`\nCapturas en ${SALIDA}`);
console.log(fallas.length ? `\n${fallas.length} falla(s)` : '\nTodo pasa');
process.exit(fallas.length ? 1 : 0);
