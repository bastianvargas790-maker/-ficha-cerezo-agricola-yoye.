#!/usr/bin/env node
// Migración histórica de DB_Aforos -> Supabase (aforos + aforo_lecturas).
//
// NO EJECUTAR sin autorización explícita de Bastián. Requiere:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role -- este script corre
//   fuera de RLS a propósito, para poder fijar creado_por/legacy_id/fuente sin
//   depender de una sesión de usuario), ORGANIZACION_ID, MIGRADOR_USER_ID
//   (uuid de auth.users que queda como creado_por/actualizado_por).
//
// Uso: node scripts/migrar-aforos-historicos.mjs [--dry-run]
//
// Qué hace:
//   1. Descarga DB_Aforos completo desde el gviz público de Google Sheets.
//   2. Excluye AF-2026-001 (prueba confirmada) y cualquier fila sin ID_Aforo real.
//   3. Excluye 13A, 13B y 34 (Tipo 3 / sin correspondencia segura -- ver reporte
//      de arquitectura de datos, auditoría del 23-08-2026).
//   4. Resuelve cada ID_Cuartel restante contra CUARTEL_EQUIVALENCIAS: código de
//      cuartel destino + unidad_aforo cuando corresponde (solo C-40 hoy).
//   5. Inserta en aforos con legacy_id = ID_Aforo, fuente = 'db_aforos_historico',
//      migracion_lote = un UUID nuevo por corrida (para poder hacer rollback
//      dirigido -- ver scripts/rollback-migracion-aforos.sql).
//   6. Inserta las 16 lecturas de cada aforo en aforo_lecturas.
//   7. on conflict (legacy_id) do nothing -- correr el script dos veces no duplica.
//
// --dry-run imprime lo que haría sin escribir nada en Supabase.

import { randomUUID } from 'node:crypto';

const DB_APOROS_SHEET_ID = '1LvjVudRJOVSvECWLiUp8txZfB9aNLGvk-zWd5MY9o7A';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${DB_APOROS_SHEET_ID}/gviz/tq?sheet=DB_Aforos&range=A1%3ACC5000&headers=1&tqx=out%3Ajson`;

// Excluidos con motivo explícito -- ver "Lista de pendientes/excluidos" del
// reporte de arquitectura de datos (23-08-2026).
const EXCLUIDOS = {
  'AF-2026-001': 'Prueba confirmada (Observaciones: "PRUEBA CONTROLADA DE SINCRONIZACIÓN 2026")',
  'AF-2025-030': '13A: Tipo 3, sin evidencia de válvula/línea compartida como en C-40',
  'AF-2025-031': '13B: mismo motivo que 13A',
  'AF-2025-032': '34: no se sabe a cuál de 34-1/34-2/34-3 corresponde',
};

// { código DB_Aforos: { cuartelCodigo, unidadAforo } }
// cuartelCodigo es el código que debe existir en public.cuarteles.codigo.
// 14A/14B se resolvieron como Tipo 1 (cuartel independiente): variedades
// distintas (Lapins vs Santina) excluyen lógicamente que sean una sola unidad
// de aforo -- una variedad es un atributo de plantación, no de medición.
const CUARTEL_EQUIVALENCIAS = {
  '1': { cuartelCodigo: 'C-1' }, '2': { cuartelCodigo: 'C-2' }, '3': { cuartelCodigo: 'C-3' },
  '5': { cuartelCodigo: 'C-5' }, '6': { cuartelCodigo: 'C-6' }, '7': { cuartelCodigo: 'C-7' },
  '14A': { cuartelCodigo: 'C-14A' }, '14B': { cuartelCodigo: 'C-14B' },
  '15': { cuartelCodigo: 'C-15' }, '16': { cuartelCodigo: 'C-16' }, '17': { cuartelCodigo: 'C-17' },
  '18': { cuartelCodigo: 'C-20-18' }, '20': { cuartelCodigo: 'C-20-18' },
  '21': { cuartelCodigo: 'C-21' }, '22': { cuartelCodigo: 'C-22' }, '23': { cuartelCodigo: 'C-23' },
  '24': { cuartelCodigo: 'C-24' }, '26': { cuartelCodigo: 'C-26' }, '27': { cuartelCodigo: 'C-27' },
  '28': { cuartelCodigo: 'C-28' }, '29': { cuartelCodigo: 'C-29' },
  '30': { cuartelCodigo: 'C-30-32' }, '31': { cuartelCodigo: 'C-31' }, '32': { cuartelCodigo: 'C-30-32' },
  '33': { cuartelCodigo: 'C-33' }, '35': { cuartelCodigo: 'C-35' }, '36': { cuartelCodigo: 'C-36' },
  '37': { cuartelCodigo: 'C-37' }, '38': { cuartelCodigo: 'C-38' }, '39': { cuartelCodigo: 'C-39' },
  '40 A': { cuartelCodigo: 'C-40', unidadAforo: 'A' }, // Confirmado por Bastián: C-40 es un
  '40B': { cuartelCodigo: 'C-40', unidadAforo: 'B' },  // solo cuartel, aforado por 2 válvulas.
  'Isla': { cuartelCodigo: 'Isla' }, // Sin confirmar si lleva prefijo "C-" -- ver reporte, pendiente.
};

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
  return (json.table.rows || [])
    .filter(row => val(row, 'ID_Cuartel'))
    .map(row => ({
      idAforo: val(row, 'ID_Aforo'),
      cuartelRaw: String(val(row, 'ID_Cuartel')),
      temporada: val(row, 'Temporada'),
      fecha: parseGvizDate(val(row, 'Fecha')),
      nValvulas: val(row, 'N_Valvulas'),
      // Se conserva la posición de cada válvula (ver el mismo criterio en
      // assets/aforo.js readValves) en vez de compactar filtrando nulos.
      pe: [1, 2, 3, 4, 5].map(i => val(row, `PE_${i}`)),
      ps: [1, 2, 3, 4, 5].map(i => val(row, `PS_${i}`)),
      presionEntradaProm: val(row, 'Presion_Entrada_Prom'),
      presionSalidaProm: val(row, 'Presion_Salida_Prom'),
      perdidaCargaBar: val(row, 'Perdida_Carga_bar'),
      perdidaCargaPct: val(row, 'Perdida_Carga_pct'),
      tiempoS: val(row, 'Tiempo_s'),
      qMedio: val(row, 'Q_Medio'),
      q25: val(row, 'Q_25'),
      cu: val(row, 'CU'),
      clasificacion: val(row, 'Clasificacion'),
      observaciones: val(row, 'Observaciones'),
      lecturas: LINEAS.flatMap(linea => POSICIONES.map(([sufijo, posicion], orden) => ({
        linea, posicion, orden: (linea - 1) * 4 + orden,
        volumen_ml: val(row, `V_L${linea}_${sufijo}`),
        caudal_l_h: val(row, `Q_L${linea}_${sufijo}`), // se conserva el valor original, no se recalcula
      }))),
    }));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const filas = await fetchDbAforos();
  const loteId = randomUUID();

  const paraMigrar = [];
  const excluidos = [];
  for (const fila of filas) {
    if (EXCLUIDOS[fila.idAforo]) { excluidos.push({ ...fila, motivo: EXCLUIDOS[fila.idAforo] }); continue; }
    const equivalencia = CUARTEL_EQUIVALENCIAS[fila.cuartelRaw];
    if (!equivalencia) { excluidos.push({ ...fila, motivo: `Sin equivalencia definida para "${fila.cuartelRaw}"` }); continue; }
    paraMigrar.push({ ...fila, ...equivalencia });
  }

  console.log(`Lote de migración: ${loteId}`);
  console.log(`Total en DB_Aforos: ${filas.length}`);
  console.log(`Listos para migrar: ${paraMigrar.length}`);
  console.log(`Excluidos: ${excluidos.length}`);
  excluidos.forEach(e => console.log(`  - ${e.idAforo} (cuartel ${e.cuartelRaw}): ${e.motivo}`));

  if (dryRun) {
    console.log('\n--dry-run: no se escribió nada en Supabase.');
    console.log(JSON.stringify(paraMigrar.map(f => ({ idAforo: f.idAforo, cuartelCodigo: f.cuartelCodigo, unidadAforo: f.unidadAforo || null })), null, 2));
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orgId = process.env.ORGANIZACION_ID, userId = process.env.MIGRADOR_USER_ID;
  if (!url || !key || !orgId || !userId) throw new Error('Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZACION_ID, MIGRADOR_USER_ID');
  const supabase = createClient(url, key);

  const { data: cuarteles, error: cuartelesError } = await supabase.from('cuarteles').select('id,codigo').eq('organizacion_id', orgId);
  if (cuartelesError) throw cuartelesError;
  const cuartelPorCodigo = new Map(cuarteles.map(c => [c.codigo, c.id]));

  let migrados = 0, sinCuartel = [];
  for (const fila of paraMigrar) {
    const cuartelId = cuartelPorCodigo.get(fila.cuartelCodigo);
    if (!cuartelId) { sinCuartel.push(fila); continue; }
    const { data: aforo, error: aforoError } = await supabase.from('aforos').upsert({
      organizacion_id: orgId, cuartel_id: cuartelId, unidad_aforo: fila.unidadAforo || null,
      temporada: fila.temporada, fecha: fila.fecha, n_valvulas: fila.nValvulas || 0,
      presiones_entrada: fila.pe, presiones_salida: fila.ps,
      presion_entrada_prom: fila.presionEntradaProm, presion_salida_prom: fila.presionSalidaProm,
      perdida_carga_bar: fila.perdidaCargaBar, perdida_carga_pct: fila.perdidaCargaPct,
      tiempo_medicion_s: fila.tiempoS, q_medio: fila.qMedio, q_25: fila.q25, cu: fila.cu,
      clasificacion: fila.clasificacion, observaciones: fila.observaciones,
      legacy_id: fila.idAforo, fuente: 'db_aforos_historico', migracion_lote: loteId,
      creado_por: userId, actualizado_por: userId,
    }, { onConflict: 'legacy_id' }).select('id').single();
    if (aforoError) { console.error(`Error migrando ${fila.idAforo}:`, aforoError.message); continue; }
    const lecturasRows = fila.lecturas.filter(l => l.volumen_ml !== null).map(l => ({ aforo_id: aforo.id, ...l }));
    if (lecturasRows.length) {
      const { error: lecturasError } = await supabase.from('aforo_lecturas').upsert(lecturasRows, { onConflict: 'aforo_id,linea,posicion' });
      if (lecturasError) { console.error(`Error en lecturas de ${fila.idAforo}:`, lecturasError.message); continue; }
    }
    migrados++;
  }

  console.log(`\nMigrados: ${migrados}/${paraMigrar.length}`);
  if (sinCuartel.length) {
    console.log(`Sin cuartel_id resuelto (revisar catálogo cuarteles):`);
    sinCuartel.forEach(f => console.log(`  - ${f.idAforo}: cuartelCodigo="${f.cuartelCodigo}" no existe en cuarteles.codigo`));
  }
  console.log(`\nLote de migración (guardar para un eventual rollback): ${loteId}`);
}

main().catch(error => { console.error(error); process.exit(1); });
