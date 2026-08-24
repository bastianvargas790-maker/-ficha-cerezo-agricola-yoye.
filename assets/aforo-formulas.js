// Módulo único de fórmulas de Aforo Rinconada. Compartido entre la app de
// captura (aforo-rinconada/) y el dashboard de Agrícola Yoye. NO reimplementar
// esta lógica en otro archivo — si algo cambia, cambia solo acá.
//
// Fórmula y umbrales verificados contra los 36 aforos reales de DB_Aforos
// (Bastián Vargas, 23-08-2026). 3 de esos 36 (AF-2025-014, AF-2025-026,
// AF-2025-033) tienen una lectura puntual ("Línea 2, Último") capturada con
// un tiempo de 32s mientras el resto del aforo usa 36s -- un dato real de la
// planilla original, no un error de esta fórmula. Se preserva tal cual con
// aforo_lecturas.tiempo_s_override (ver resolverTiempoEfectivo): jamás se
// sobrescribe el histórico para que "encaje" con un tiempo único por aforo.
// Con el override aplicado, calcularResultado() reproduce 36/36 CU reales.
//
// Umbrales de clasificación (Excelente >=90, Bueno >=80, Medio >=70, Bajo <70)
// reproducen 36/36 clasificaciones históricas -- son la única regla de corte
// simple compatible con los 3 huecos observados entre categorías (68.8-76.2,
// 76.2-80.0, 89.0-91.0). Viven acá, no hardcodeados en SQL, para poder
// ajustarlos sin migración si alguna vez se confirma un valor distinto contra
// una fuente primaria (el Excel original, no encontrado todavía).
(() => {
  const CU_UMBRALES = { excelente: 90, bueno: 80, medio: 70 };

  function calcularCaudal(volumenMl, tiempoS) {
    if (volumenMl === null || volumenMl === undefined || tiempoS === null || tiempoS === undefined) return null;
    const v = Number(volumenMl), t = Number(tiempoS);
    if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0) return null;
    return (v * 3.6) / t;
  }

  function calcularQMedio(caudales) {
    const validos = (caudales || []).filter(c => Number.isFinite(c));
    if (!validos.length) return null;
    return validos.reduce((a, b) => a + b, 0) / validos.length;
  }

  function calcularQ25(caudales) {
    const validos = (caudales || []).filter(c => Number.isFinite(c));
    if (!validos.length) return null;
    const ordenados = [...validos].sort((a, b) => a - b);
    const cuartoInferior = Math.max(1, Math.ceil(ordenados.length / 4));
    const bajos = ordenados.slice(0, cuartoInferior);
    return bajos.reduce((a, b) => a + b, 0) / bajos.length;
  }

  function calcularCU(qMedio, q25) {
    if (!Number.isFinite(qMedio) || !Number.isFinite(q25) || qMedio <= 0) return null;
    return (q25 / qMedio) * 100;
  }

  // El tiempo de una lectura es el general del aforo, salvo que esa lectura
  // puntual tenga una excepción documentada (tiempo_s_override). Existe para
  // preservar excepciones históricas (ej. un dato mal cronometrado en la
  // planilla original) sin inventar un tiempo "correcto" que reemplace el
  // dato real, y para correcciones manuales futuras justificadas. Los
  // registros nuevos de Aforo Rinconada nunca la usan -- queda en NULL.
  function resolverTiempoEfectivo(tiempoOverride, tiempoGeneral) {
    return tiempoOverride ?? tiempoGeneral;
  }

  function clasificarCU(cu) {
    if (!Number.isFinite(cu)) return 'Sin datos';
    if (cu >= CU_UMBRALES.excelente) return 'Excelente';
    if (cu >= CU_UMBRALES.bueno) return 'Bueno';
    if (cu >= CU_UMBRALES.medio) return 'Medio';
    return 'Bajo';
  }

  // Deriva caudal/q_medio/q_25/CU/clasificación a partir de lecturas crudas
  // {volumen_ml, tiempo_s} — usada tanto al capturar en terreno como para
  // auditar/recalcular un aforo ya guardado (ver recalcularYComparar).
  function calcularResultado(lecturas) {
    const caudales = (lecturas || []).map(l => calcularCaudal(l.volumen_ml, l.tiempo_s));
    const qMedio = calcularQMedio(caudales);
    const q25 = calcularQ25(caudales);
    const cu = calcularCU(qMedio, q25);
    return { qMedio, q25, cu, clasificacion: clasificarCU(cu) };
  }

  // No sobrescribe nada -- solo compara un resultado ya guardado contra lo que
  // dan las lecturas crudas hoy, para detectar discrepancias sin modificar el
  // histórico en silencio (ver punto 7 de la auditoría de arquitectura).
  function recalcularYComparar(lecturas, guardado) {
    const recalculado = calcularResultado(lecturas);
    const diffCu = Number.isFinite(recalculado.cu) && Number.isFinite(guardado?.cu) ? Math.abs(recalculado.cu - guardado.cu) : null;
    return { recalculado, guardado, diffCu, coincide: diffCu !== null && diffCu < 0.01 };
  }

  const api = { CU_UMBRALES, calcularCaudal, calcularQMedio, calcularQ25, calcularCU, clasificarCU, resolverTiempoEfectivo, calcularResultado, recalcularYComparar };
  globalThis.YOYE_AFORO_FORMULAS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

export default globalThis.YOYE_AFORO_FORMULAS;
