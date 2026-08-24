#!/usr/bin/env node
// Validación post-migración: compara DB_Aforos (Google Sheets) contra lo que
// quedó en Supabase (aforos + aforo_lecturas, fuente = 'db_aforos_historico').
//
// Uso: node scripts/validar-migracion-aforos.mjs
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZACION_ID
//
// Además de comparar campo a campo contra el original, recalcula q_medio/q_25/
// cu/clasificacion desde cero (volumen_ml + tiempo_s_override ?? tiempo_medicion_s,
// con aforo-formulas.js) para confirmar que lo migrado es matemáticamente
// reproducible, no solo "igual al original por casualidad".
//
// Resultado esperado: 0 pérdidas, 0 duplicados, 0 discrepancias de valores.
// Cualquier discrepancia se imprime en detalle -- este script no corrige nada,
// solo reporta.

import aforoFormulas from '../assets/aforo-formulas.js';
const { calcularCaudal, calcularResultado, resolverTiempoEfectivo } = aforoFormulas;

const DB_APOROS_SHEET_ID = '1LvjVudRJOVSvECWLiUp8txZfB9aNLGvk-zWd5MY9o7A';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${DB_APOROS_SHEET_ID}/gviz/tq?sheet=DB_Aforos&range=A1%3ACC5000&headers=1&tqx=out%3Ajson`;
const LINEAS = [1, 2, 3, 4];
const POSICIONES = [['Ini', 'inicio'], ['13', 'un_tercio'], ['23', 'dos_tercios'], ['Ult', 'ultimo']];
// Debe coincidir exactamente con EXCLUIDOS de migrar-aforos-historicos.mjs.
const NO_MIGRADOS = ['AF-2026-001', 'AF-2025-030', 'AF-2025-031', 'AF-2025-003', 'AF-2025-004', 'AF-2025-032'];

function parseGvizDate(v) {
  const m = typeof v === 'string' && /^Date\((\d+),(\d+),(\d+)/.exec(v);
  return m ? new Date(Date.UTC(+m[1], +m[2], +m[3])).toISOString().slice(0, 10) : null;
}

async function fetchDbAforos() {
  const res = await fetch(GVIZ_URL);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const cols = json.table.cols.map(c => c.label || c.id);
  const idx = name => cols.findIndex(c => c === name);
  const val = (row, name) => { const i = idx(name); return row.c && row.c[i] ? row.c[i].v : null; };
  return (json.table.rows || []).filter(row => val(row, 'ID_Cuartel')).map(row => ({
    idAforo: val(row, 'ID_Aforo'), cuartelRaw: String(val(row, 'ID_Cuartel')),
    fecha: parseGvizDate(val(row, 'Fecha')), tiempoGeneral: val(row, 'Tiempo_s'),
    cuOriginal: val(row, 'CU'), clasificacionOriginal: val(row, 'Clasificacion'),
    lecturas: LINEAS.flatMap(linea => POSICIONES.map(([sufijo, posicion]) => ({
      linea, posicion, volumen_ml: val(row, `V_L${linea}_${sufijo}`), caudalOriginal: val(row, `Q_L${linea}_${sufijo}`),
    }))).filter(l => l.volumen_ml !== null),
  }));
}

function closeEnough(a, b, tolerancia = 0.01) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerancia;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, orgId = process.env.ORGANIZACION_ID;
  if (!url || !key || !orgId) throw new Error('Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZACION_ID');
  const supabase = createClient(url, key);

  const todasLasFilas = await fetchDbAforos();
  const originalMigrable = todasLasFilas.filter(f => !NO_MIGRADOS.includes(f.idAforo));

  const { data: migrados, error } = await supabase.from('aforos')
    .select('id,legacy_id,fecha,cuartel_id,unidad_aforo,tiempo_medicion_s,q_medio,q_25,cu,clasificacion,cuarteles(codigo),aforo_lecturas(linea,posicion,volumen_ml,tiempo_s_override,caudal_l_h)')
    .eq('organizacion_id', orgId).eq('fuente', 'db_aforos_historico');
  if (error) throw error;

  const porLegacyId = new Map(migrados.map(m => [m.legacy_id, m]));
  const reporte = {
    totalOriginal: originalMigrable.length, totalMigrado: migrados.length,
    faltantes: [], duplicados: [], discrepancias: [],
    cuReproducible: { coinciden: 0, total: 0, excepciones: [] },
  };

  // Duplicados: más de un registro en Supabase con el mismo legacy_id, o más
  // de una lectura con la misma combinación aforo_id+linea+posicion.
  const conteoLegacyId = new Map();
  migrados.forEach(m => conteoLegacyId.set(m.legacy_id, (conteoLegacyId.get(m.legacy_id) || 0) + 1));
  for (const [legacyId, n] of conteoLegacyId) if (n > 1) reporte.duplicados.push({ tipo: 'aforo', legacyId, cantidad: n });
  migrados.forEach(m => {
    const claves = new Map();
    (m.aforo_lecturas || []).forEach(l => claves.set(`${l.linea}|${l.posicion}`, (claves.get(`${l.linea}|${l.posicion}`) || 0) + 1));
    for (const [clave, n] of claves) if (n > 1) reporte.duplicados.push({ tipo: 'lectura', legacyId: m.legacy_id, clave, cantidad: n });
  });

  for (const original of originalMigrable) {
    const m = porLegacyId.get(original.idAforo);
    if (!m) { reporte.faltantes.push(original.idAforo); continue; }
    const diffs = [];
    if (m.fecha !== original.fecha) diffs.push(`fecha: ${m.fecha} vs ${original.fecha}`);
    if (!closeEnough(m.tiempo_medicion_s, original.tiempoGeneral)) diffs.push(`tiempo_medicion_s: ${m.tiempo_medicion_s} vs ${original.tiempoGeneral}`);
    if ((m.aforo_lecturas || []).length !== original.lecturas.length) diffs.push(`n° lecturas: ${(m.aforo_lecturas || []).length} vs ${original.lecturas.length}`);

    // Recalcular desde cero con lo que quedó en Supabase (no confiar en
    // m.q_medio/m.cu tal cual -- reproducir el cálculo completo).
    const lecturasParaCalculo = (m.aforo_lecturas || []).map(l => ({
      volumen_ml: l.volumen_ml,
      tiempo_s: resolverTiempoEfectivo(l.tiempo_s_override, m.tiempo_medicion_s),
    }));
    const recalculado = calcularResultado(lecturasParaCalculo);
    if (!closeEnough(recalculado.qMedio, m.q_medio)) diffs.push(`q_medio guardado (${m.q_medio}) no coincide con el recalculado desde lecturas (${recalculado.qMedio})`);
    if (!closeEnough(recalculado.q25, m.q_25)) diffs.push(`q_25 guardado (${m.q_25}) no coincide con el recalculado (${recalculado.q25})`);
    if (!closeEnough(recalculado.cu, m.cu)) diffs.push(`cu guardado (${m.cu}) no coincide con el recalculado (${recalculado.cu})`);
    if (recalculado.clasificacion !== m.clasificacion) diffs.push(`clasificacion guardada (${m.clasificacion}) no coincide con la recalculada (${recalculado.clasificacion})`);

    // Reproducibilidad histórica: el CU guardado en Supabase vs el CU original
    // de DB_Aforos (el objetivo es 36/36 coincidencias tras el fix de
    // tiempo_s_override).
    reporte.cuReproducible.total++;
    if (closeEnough(m.cu, original.cuOriginal)) reporte.cuReproducible.coinciden++;
    else reporte.cuReproducible.excepciones.push({ idAforo: original.idAforo, cuOriginal: original.cuOriginal, cuMigrado: m.cu });

    if (diffs.length) reporte.discrepancias.push({ idAforo: original.idAforo, diffs });
  }

  console.log(JSON.stringify(reporte, null, 2));
  const ok = reporte.faltantes.length === 0 && reporte.duplicados.length === 0 && reporte.discrepancias.length === 0
    && reporte.cuReproducible.coinciden === reporte.cuReproducible.total;
  console.log(ok
    ? `\nOK: 0 pérdidas, 0 duplicados, 0 discrepancias, CU reproducible ${reporte.cuReproducible.coinciden}/${reporte.cuReproducible.total}.`
    : '\nATENCIÓN: revisar el detalle de arriba antes de continuar.');
  process.exit(ok ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
