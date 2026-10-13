/**
 * Subir programa de fertilización — Apps Script de la planilla del campo.
 *
 * Lee cada hoja de cuartel, toma las columnas que tienen fecha en la fila de
 * encabezado y manda a la app lo que esté escrito en ellas. Eso es el programa:
 * los kilos que el asesor dejó anotados para las próximas fechas.
 *
 * Cómo se instala (una sola vez):
 *   1. En la planilla: Extensiones → Apps Script.
 *   2. Pegar este archivo y guardar.
 *   3. Configuración del proyecto → Propiedades del script, agregar:
 *        SUPABASE_FUNCION = https://<proyecto>.supabase.co/functions/v1/programa-fertilizacion
 *        SYNC_SECRET      = el mismo secreto que ya usa la sincronización de calicatas
 *   4. Recargar la planilla. Aparece el menú "Agrícola Yoye".
 *
 * Después, cada vez que cambie el programa: Agrícola Yoye → Subir programa.
 * Se puede apretar las veces que sea: lo que ya estaba se actualiza, no se
 * duplica, y lo que el asesor borró de la planilla se da de baja en la app.
 */

/** Hojas que no son cuarteles. */
var NO_CUARTELES = ['Dashboard', 'Catálogo de Productos', 'Total Acumulado Temporada',
                    'Unidades Totales', 'Hoja 1', 'Hoja1'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Agrícola Yoye')
    .addItem('Subir programa a la app', 'subirPrograma')
    .addItem('Ver qué se va a subir', 'previsualizarPrograma')
    .addToUi();
}

/** Encuentra la fila del encabezado (la que dice "producto" en la columna B). */
function filaEncabezado_(valores) {
  for (var r = 0; r < Math.min(valores.length, 15); r++) {
    var b = String(valores[r][1] || '').trim().toLowerCase();
    if (b === 'producto') return r;
  }
  return -1;
}

function aFecha_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  return null;
}

function yyyymmdd_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** La temporada parte en julio: agosto de 2026 y enero de 2027 son 2026-2027. */
function temporadaDe_(d) {
  var a = d.getFullYear(), m = d.getMonth() + 1;
  var inicio = m >= 7 ? a : a - 1;
  return inicio + '-' + (inicio + 1);
}

/** Lee la planilla completa y devuelve las filas del programa. */
function leerPrograma_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var filas = [], avisos = [];
  ss.getSheets().forEach(function (sheet) {
    var nombre = sheet.getName().trim();
    if (NO_CUARTELES.indexOf(nombre) >= 0) return;
    var valores = sheet.getDataRange().getValues();
    var hr = filaEncabezado_(valores);
    if (hr < 0) { avisos.push(nombre + ': sin fila de encabezado'); return; }

    // Columnas con fecha en el encabezado. Las de "Total sep" y similares no
    // son fechas, así que quedan fuera solas.
    var columnas = [];
    for (var c = 8; c < valores[hr].length; c++) {
      var f = aFecha_(valores[hr][c]);
      if (f) columnas.push({ c: c, fecha: f });
    }
    if (!columnas.length) { avisos.push(nombre + ': sin columnas de fecha'); return; }

    for (var r = hr + 1; r < valores.length; r++) {
      var producto = String(valores[r][1] || '').trim();
      if (!producto) continue;
      // El bloque de productos adicionales viene después y tiene otra forma.
      if (producto.toUpperCase().indexOf('PRODUCTOS ADICIONALES') === 0) break;
      if (producto.toUpperCase().indexOf('RESUMEN TEMPORADA') === 0) break;
      columnas.forEach(function (col) {
        var v = valores[r][col.c];
        if (typeof v !== 'number' || !v) return;
        filas.push({
          cuartel: nombre,
          producto: producto,
          fecha: yyyymmdd_(col.fecha),
          cantidad: v,
          temporada: temporadaDe_(col.fecha)
        });
      });
    }
  });
  return { filas: filas, avisos: avisos };
}

function previsualizarPrograma() {
  var r = leerPrograma_();
  var porCuartel = {};
  r.filas.forEach(function (f) { porCuartel[f.cuartel] = (porCuartel[f.cuartel] || 0) + 1; });
  var detalle = Object.keys(porCuartel).sort().map(function (k) {
    return '  ' + k + ': ' + porCuartel[k];
  }).join('\n');
  SpreadsheetApp.getUi().alert(
    'Se subirían ' + r.filas.length + ' líneas de ' + Object.keys(porCuartel).length + ' cuarteles.\n\n' +
    detalle + (r.avisos.length ? '\n\nHojas que quedan fuera:\n  ' + r.avisos.join('\n  ') : ''));
}

function subirPrograma() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_FUNCION');
  var secreto = props.getProperty('SYNC_SECRET');
  if (!url || !secreto) {
    ui.alert('Falta configurar SUPABASE_FUNCION y SYNC_SECRET en las propiedades del script.');
    return;
  }
  var r = leerPrograma_();
  if (!r.filas.length) { ui.alert('No encontré nada escrito en columnas con fecha.'); return; }

  var confirma = ui.alert('Subir programa',
    'Se van a subir ' + r.filas.length + ' líneas a la app.\n\n' +
    'Lo que ya estaba se actualiza y lo que borraste de la planilla se da de baja. ¿Continuamos?',
    ui.ButtonSet.OK_CANCEL);
  if (confirma !== ui.Button.OK) return;

  // Se manda por tandas para no pasarse del límite de tamaño de Apps Script.
  var TANDA = 400, subidas = 0, errores = [];
  for (var i = 0; i < r.filas.length; i += TANDA) {
    var tanda = r.filas.slice(i, i + TANDA);
    var cuerpo = {
      sync_secret: secreto,
      planilla: SpreadsheetApp.getActiveSpreadsheet().getId(),
      reemplazar: i === 0,          // la primera tanda marca el corte de lo viejo
      ultima: i + TANDA >= r.filas.length,
      filas: tanda
    };
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Yoye-Sync-Secret': secreto },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true
    });
    var texto = resp.getContentText();
    if (resp.getResponseCode() !== 200) { errores.push(resp.getResponseCode() + ': ' + texto.slice(0, 200)); break; }
    var out = {};
    try { out = JSON.parse(texto); } catch (e) {}
    if (!out.ok) { errores.push(texto.slice(0, 200)); break; }
    subidas += (out.guardadas || 0);
    if (out.sin_cuartel && out.sin_cuartel.length) {
      errores.push('Sin cuartel en la base: ' + out.sin_cuartel.join(', '));
    }
  }
  ui.alert(errores.length
    ? 'Se subieron ' + subidas + ' líneas.\n\nAvisos:\n' + errores.join('\n')
    : 'Listo: ' + subidas + ' líneas del programa quedaron en la app.');
}
