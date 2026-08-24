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
//   2. Excluye AF-2026-001 (prueba confirmada), 13A, 13B, 14A, 14B y 34 -- ver
//      EXCLUIDOS abajo para el motivo exacto de cada uno.
//   3. Resuelve cada ID_Cuartel restante contra CUARTEL_EQUIVALENCIAS.
//   4. Detecta automáticamente, por lectura, si el tiempo implícito por el
//      Q_L/V_L original difiere del tiempo_medicion_s general del aforo (pasa
//      en 3 de 37 filas, siempre en la misma celda "Línea 2, Último" -- un
//      dato real de la planilla, no un error de esta fórmula). Si difiere,
//      guarda ese tiempo en tiempo_s_override SIN alterar el volumen ni
//      inventar un tiempo "correcto" -- el histórico se preserva tal cual.
//   5. Recalcula caudal_l_h, q_medio, q_25 y cu con aforo-formulas.js a partir
//      de volumen_ml + tiempo efectivo (no copia los valores precalculados de
//      DB_Aforos) -- así el resultado es matemáticamente reproducible, no
//      solo "confiado". Compara contra el CU original y lo reporta.
//   6. Inserta con legacy_id = ID_Aforo, fuente = 'db_aforos_historico',
//      migracion_lote = un UUID nuevo por corrida (para rollback dirigido).
//   7. on conflict (legacy_id) do nothing -- correr el script dos veces no duplica.
//
// --dry-run imprime lo que haría, incluyendo la comparación CU original vs
// recalculado de las 36 filas reales, sin escribir nada en Supabase.

import { randomUUID } from 'node:crypto';
import aforoFormulas from '../assets/aforo-formulas.js';
const { calcularCaudal, calcularResultado, resolverTiempoEfectivo } = aforoFormulas;

const DB_APOROS_SHEET_ID = '1LvjVudRJOVSvECWLiUp8txZfB9aNLGvk-zWd5MY9o7A';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${DB_APOROS_SHEET_ID}/gviz/tq?sheet=DB_Aforos&range=A1%3ACC5000&headers=1&tqx=out%3Ajson`;
const TOLERANCIA_SEGUNDOS = 0.5; // diferencia mínima para considerar que una celda usó otro tiempo

// Excluidos con motivo explícito -- ver reporte de arquitectura de datos
// (23-08-2026, ronda de cierre). 14A/14B se movieron aquí: la variedad
// distinta (Lapins vs Santina) y el tracking administrativo independiente en
// Registro Aplicaciones son evidencia fuerte, pero no son una confirmación
// directa de que existan como filas propias en public.cuarteles -- no tengo
// acceso a esa tabla para verificarlo. Por regla explícita de Bastián, sin esa
// confirmación quedan pendientes, no migrables.
const EXCLUIDOS = {
  'AF-2026-001': 'Prueba confirmada (Observaciones: "PRUEBA CONTROLADA DE SINCRONIZACIÓN 2026")',
  'AF-2025-030': '13A: Tipo 3, sin evidencia de válvula/línea compartida como en C-40',
  'AF-2025-031': '13B: mismo motivo que 13A',
  'AF-2025-003': '14A: variedad distinta a 14B sugiere cuartel propio, pero sin confirmar contra la tabla cuarteles real -- pendiente hasta que Bastián lo verifique directamente',
  'AF-2025-004': '14B: mismo motivo que 14A',
  'AF-2025-032': '34: no se sabe a cuál de 34-1/34-2/34-3 corresponde',
};

// { código DB_Aforos: { cuartelCodigo, unidadAforo } }
// cuartelCodigo es el código que debe existir en public.cuarteles.codigo.
const CUARTEL_EQUIVALENCIAS = {
  '1': { cuartelCodigo: 'C-1' }, '2': { cuartelCodigo: 'C-2' }, '3': { cuartelCodigo: 'C-3' },
  '5': { cuartelCodigo: 'C-5' }, '6': { cuartelCodigo: 'C-6' }, '7': { cuartelCodigo: 'C-7' },
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
    .map(row => {
      const tiempoGeneral = val(row, 'Tiempo_s');
      const lecturas = LINEAS.flatMap(linea => POSICIONES.map(([sufijo, posicion], orden) => {
        const volumenMl = val(row, `V_L${linea}_${sufijo}`);
        const caudalOriginal = val(row, `Q_L${linea}_${sufijo}`);
        // Tiempo implícito por el dato original: volumen*3.6/caudal. Si difiere
        // del tiempo general declarado, esa celda tiene una excepción real.
        const tiempoImplicito = volumenMl !== null && caudalOriginal ? (volumenMl * 3.6) / caudalOriginal : null;
        const tieneOverride = tiempoImplicito !== null && tiempoGeneral !== null && Math.abs(tiempoImplicito - tiempoGeneral) > TOLERANCIA_SEGUNDOS;
        return {
          linea, posicion, orden: (linea - 1) * 4 + orden,
          volumen_ml: volumenMl,
          tiempo_s_override: tieneOverride ? tiempoImplicito : null,
          caudalOriginal, // solo para comparar en el reporte, no se guarda en Supabase tal cual
        };
      }));
      return {
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
        tiempoGeneral,
        cuOriginal: val(row, 'CU'),
        clasificacionOriginal: val(row, 'Clasificacion'),
        observaciones: val(row, 'Observaciones'),
        lecturas,
      };
    });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const filas = await fetchDbAforos();
  const loteId = randomUUID();

  const paraMigrar = [];
  const excluidos = [];
  let coincidenExactos = 0;
  const noCoinciden = [];
  let totalOverrides = 0;

  for (const fila of filas) {
    // Recalcular SIEMPRE (incluso para excluidos) para poder reportar el
    // punto 8 del entregable (CU histórico vs recalculado) sobre las 36
    // filas reales, no solo sobre las que se migran.
    const lecturasConTiempo = fila.lecturas.map(l => ({
      ...l,
      tiempo_s: resolverTiempoEfectivo(l.tiempo_s_override, fila.tiempoGeneral),
    }));
    const recalculado = calcularResultado(lecturasConTiempo);
    const esPrueba2026 = fila.idAforo === 'AF-2026-001';
    if (!esPrueba2026) {
      const diff = Number.isFinite(recalculado.cu) && Number.isFinite(fila.cuOriginal) ? Math.abs(recalculado.cu - fila.cuOriginal) : null;
      if (diff !== null && diff < 0.01) coincidenExactos++;
      else noCoinciden.push({ idAforo: fila.idAforo, cuOriginal: fila.cuOriginal, cuRecalculado: recalculado.cu, diff });
    }
    totalOverrides += lecturasConTiempo.filter(l => l.tiempo_s_override !== null).length;

    if (EXCLUIDOS[fila.idAforo]) { excluidos.push({ ...fila, motivo: EXCLUIDOS[fila.idAforo] }); continue; }
    const equivalencia = CUARTEL_EQUIVALENCIAS[fila.cuartelRaw];
    if (!equivalencia) { excluidos.push({ ...fila, motivo: `Sin equivalencia definida para "${fila.cuartelRaw}"` }); continue; }
    paraMigrar.push({ ...fila, ...equivalencia, lecturasFinal: lecturasConTiempo, recalculado });
  }

  const totalReal = filas.filter(f => f.idAforo !== 'AF-2026-001').length;
  console.log(`Lote de migración: ${loteId}`);
  console.log(`Total en DB_Aforos (filas con datos): ${filas.length}`);
  console.log(`Total de aforos reales (excluye prueba 2026): ${totalReal}`);
  console.log(`Migrables: ${paraMigrar.length}`);
  console.log(`Pendientes/excluidos: ${excluidos.length}`);
  excluidos.forEach(e => console.log(`  - ${e.idAforo} (cuartel ${e.cuartelRaw}): ${e.motivo}`));
  console.log(`\nLecturas con tiempo_s_override detectado: ${totalOverrides}`);
  console.log(`CU recalculado vs histórico: ${coincidenExactos}/${totalReal} coinciden exactos (tolerancia 0.01%)`);
  if (noCoinciden.length) { console.log('No coinciden:'); noCoinciden.forEach(n => console.log(`  - ${n.idAforo}: original=${n.cuOriginal} recalculado=${n.cuRecalculado} diff=${n.diff}`)); }

  if (dryRun) {
    console.log('\n--dry-run: no se escribió nada en Supabase.');
    console.log(JSON.stringify(paraMigrar.map(f => ({ idAforo: f.idAforo, cuartelCodigo: f.cuartelCodigo, unidadAforo: f.unidadAforo || null, overrides: f.lecturasFinal.filter(l => l.tiempo_s_override !== null).length })), null, 2));
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
      tiempo_medicion_s: fila.tiempoGeneral,
      q_medio: fila.recalculado.qMedio, q_25: fila.recalculado.q25, cu: fila.recalculado.cu,
      clasificacion: fila.recalculado.clasificacion, observaciones: fila.observaciones,
      legacy_id: fila.idAforo, fuente: 'db_aforos_historico', migracion_lote: loteId,
      creado_por: userId, actualizado_por: userId,
    }, { onConflict: 'legacy_id' }).select('id').single();
    if (aforoError) { console.error(`Error migrando ${fila.idAforo}:`, aforoError.message); continue; }
    const lecturasRows = fila.lecturasFinal
      .filter(l => l.volumen_ml !== null)
      .map(({ caudalOriginal, ...l }) => ({
        aforo_id: aforo.id, linea: l.linea, posicion: l.posicion, orden: l.orden,
        volumen_ml: l.volumen_ml, tiempo_s_override: l.tiempo_s_override,
        caudal_l_h: calcularCaudal(l.volumen_ml, l.tiempo_s),
      }));
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
