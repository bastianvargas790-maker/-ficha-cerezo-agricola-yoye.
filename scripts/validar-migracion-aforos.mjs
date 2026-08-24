#!/usr/bin/env node
// Validación post-migración: compara DB_Aforos (Google Sheets) contra lo que
// quedó en Supabase (aforos + aforo_lecturas, fuente = 'db_aforos_historico').
//
// Uso: node scripts/validar-migracion-aforos.mjs
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZACION_ID
//
// Resultado esperado: 0 pérdidas, 0 duplicados, 0 discrepancias de valores.
// Cualquier discrepancia se imprime en detalle -- este script no corrige nada,
// solo reporta.

const DB_APOROS_SHEET_ID = '1LvjVudRJOVSvECWLiUp8txZfB9aNLGvk-zWd5MY9o7A';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${DB_APOROS_SHEET_ID}/gviz/tq?sheet=DB_Aforos&range=A1%3ACC5000&headers=1&tqx=out%3Ajson`;
const LINEAS = [1, 2, 3, 4];
const POSICIONES = [['Ini', 'inicio'], ['13', 'un_tercio'], ['23', 'dos_tercios'], ['Ult', 'ultimo']];

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
    fecha: parseGvizDate(val(row, 'Fecha')), tiempoS: val(row, 'Tiempo_s'),
    qMedio: val(row, 'Q_Medio'), q25: val(row, 'Q_25'), cu: val(row, 'CU'), clasificacion: val(row, 'Clasificacion'),
    lecturas: LINEAS.flatMap(linea => POSICIONES.map(([sufijo, posicion]) => ({
      linea, posicion, volumen_ml: val(row, `V_L${linea}_${sufijo}`), caudal_l_h: val(row, `Q_L${linea}_${sufijo}`),
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
  const originalMigrable = todasLasFilas.filter(f => !['AF-2026-001', 'AF-2025-030', 'AF-2025-031', 'AF-2025-032'].includes(f.idAforo));

  const { data: migrados, error } = await supabase.from('aforos')
    .select('id,legacy_id,fecha,cuartel_id,unidad_aforo,tiempo_medicion_s,q_medio,q_25,cu,clasificacion,cuarteles(codigo),aforo_lecturas(linea,posicion,volumen_ml,caudal_l_h)')
    .eq('organizacion_id', orgId).eq('fuente', 'db_aforos_historico');
  if (error) throw error;

  const porLegacyId = new Map(migrados.map(m => [m.legacy_id, m]));
  const reporte = { totalOriginal: originalMigrable.length, totalMigrado: migrados.length, faltantes: [], duplicados: [], discrepancias: [] };

  // Duplicados: más de un registro en Supabase con el mismo legacy_id.
  const conteoLegacyId = new Map();
  migrados.forEach(m => conteoLegacyId.set(m.legacy_id, (conteoLegacyId.get(m.legacy_id) || 0) + 1));
  for (const [legacyId, n] of conteoLegacyId) if (n > 1) reporte.duplicados.push({ legacyId, cantidad: n });

  for (const original of originalMigrable) {
    const m = porLegacyId.get(original.idAforo);
    if (!m) { reporte.faltantes.push(original.idAforo); continue; }
    const diffs = [];
    if (m.fecha !== original.fecha) diffs.push(`fecha: ${m.fecha} vs ${original.fecha}`);
    if (!closeEnough(m.tiempo_medicion_s, original.tiempoS)) diffs.push(`tiempo_medicion_s: ${m.tiempo_medicion_s} vs ${original.tiempoS}`);
    if (!closeEnough(m.q_medio, original.qMedio)) diffs.push(`q_medio: ${m.q_medio} vs ${original.qMedio}`);
    if (!closeEnough(m.q_25, original.q25)) diffs.push(`q_25: ${m.q_25} vs ${original.q25}`);
    if (!closeEnough(m.cu, original.cu)) diffs.push(`cu: ${m.cu} vs ${original.cu}`);
    if (m.clasificacion !== original.clasificacion) diffs.push(`clasificacion: ${m.clasificacion} vs ${original.clasificacion}`);
    if ((m.aforo_lecturas || []).length !== original.lecturas.length) diffs.push(`n° lecturas: ${(m.aforo_lecturas || []).length} vs ${original.lecturas.length}`);
    else {
      for (const lecturaOriginal of original.lecturas) {
        const lecturaMigrada = (m.aforo_lecturas || []).find(l => l.linea === lecturaOriginal.linea && l.posicion === lecturaOriginal.posicion);
        if (!lecturaMigrada) { diffs.push(`falta lectura L${lecturaOriginal.linea}_${lecturaOriginal.posicion}`); continue; }
        if (!closeEnough(lecturaMigrada.volumen_ml, lecturaOriginal.volumen_ml)) diffs.push(`L${lecturaOriginal.linea}_${lecturaOriginal.posicion} volumen_ml: ${lecturaMigrada.volumen_ml} vs ${lecturaOriginal.volumen_ml}`);
        if (!closeEnough(lecturaMigrada.caudal_l_h, lecturaOriginal.caudal_l_h)) diffs.push(`L${lecturaOriginal.linea}_${lecturaOriginal.posicion} caudal_l_h: ${lecturaMigrada.caudal_l_h} vs ${lecturaOriginal.caudal_l_h}`);
      }
    }
    if (diffs.length) reporte.discrepancias.push({ idAforo: original.idAforo, diffs });
  }

  console.log(JSON.stringify(reporte, null, 2));
  const ok = reporte.faltantes.length === 0 && reporte.duplicados.length === 0 && reporte.discrepancias.length === 0;
  console.log(ok ? '\nOK: 0 pérdidas, 0 duplicados, 0 discrepancias.' : '\nATENCIÓN: revisar el detalle de arriba antes de continuar.');
  process.exit(ok ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
