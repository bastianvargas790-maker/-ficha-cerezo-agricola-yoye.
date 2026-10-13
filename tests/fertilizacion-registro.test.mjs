import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Registro de fertilizaciones: reemplaza en la hoja "Registrar" al ítem de
   riego, que no se estaba usando. Lo que se prueba de verdad -- que el modal
   abre, guarda sin señal y conserva el cuartel -- está en
   pruebas/terreno/revisar-fertilizacion.mjs, que abre la app en un navegador. */
const fert = readFileSync(new URL('../assets/fertilizacion.js', import.meta.url), 'utf8');
const campos = readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/campos.css', import.meta.url), 'utf8');
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');

test('la hoja Registrar ya no ofrece riego y sí fertilización', () => {
  const bloque = campos.slice(campos.indexOf('function registrosDisponibles'), campos.indexOf('function hojaRegistrarHtml'));
  assert.ok(!/id:'riego'/.test(bloque), 'el ítem de riego debe salir');
  assert.ok(bloque.includes("id:'fertilizacion'"), 'falta el ítem de fertilización');
  assert.ok(bloque.includes("d:'Productos y kilos por cuartel'"));
  assert.match(campos, /if\(el\.dataset\.registro==='fertilizacion'\)\{cerrarHoja\(\);window\.yoyeAbrirFertilizacion\?\.\(\);return\}/);
});

test('se registra cuartel, fecha y varias filas de producto con su unidad', () => {
  assert.match(fert, /const filaVacia=\(\)=>\(\{id:uuid\(\),producto_id:'',nombre_nuevo:'',cantidad:'',unidad:'kg'\}\)/);
  assert.ok(fert.includes('Otro producto…'), 'debe dejar escribir un producto que no está en el catálogo');
  assert.ok(fert.includes("<option value=\"L\""), 'la unidad se elige entre kilos y litros');
  assert.match(css, /\.yoye-fert-fila\{/);
  assert.match(css, /\.yoye-fert-cantidad\{display:grid/);
});

test('una fila cuenta solo con producto y cantidad; lo demás se avisa', () => {
  assert.match(fert, /function filaCompleta\(f\)\{[\s\S]*?return !!nombre&&num\(f\.cantidad\)>0/);
  assert.ok(fert.includes('filas a medias sin guardar'), 'hay que decir cuántas filas quedaron fuera');
  assert.ok(fert.includes("'Anota al menos un producto con sus kilos o litros.'"));
});

test('guarda primero en el teléfono y sube después, como calicatas y aforo', () => {
  assert.match(fert, /const DB_NAME='yoye-fert-offline-v1'/);
  assert.ok(fert.includes("'Guardado en el dispositivo. Se enviará al recuperar internet.'"),
    'sin señal hay que decir que quedó en el teléfono');
  assert.match(fert, /async function syncQueue\(host\)/);
  assert.ok(fert.includes("upsert(filas,{onConflict:'id'})"), 'reenviar no debe duplicar');
  assert.match(fert, /addEventListener\('online',\(\)=>syncQueue\(null\)\)/);
});

test('el producto escrito a mano se busca por clave antes de crearlo', () => {
  assert.match(fert, /const claveProducto=s=>String\(s\|\|''\)\.toLowerCase\(\)\.normalize\('NFD'\)/);
  assert.ok(fert.includes(".eq('clave',clave).maybeSingle()"), 'primero se busca el producto existente');
  assert.ok(fert.includes("notas:'Agregado desde el registro en terreno; falta su ley de nutrientes.'"));
});

test('las unidades de nutriente no se escriben: salen de la ley del producto', () => {
  for (const campo of ['u_n', 'ley_n', 'unidades_n'])
    assert.ok(!new RegExp(`${campo}\\s*:`).test(fert), `${campo} no se guarda desde el formulario`);
});

test('la temporada sale de la fecha y parte en julio', () => {
  assert.match(fert, /const inicio=m>=7\?a:a-1/);
  assert.match(fert, /return `\$\{inicio\}-\$\{inicio\+1\}`/);
});

test('el cuartel queda puesto para la siguiente carga', () => {
  assert.ok(fert.includes('state=estadoInicial(cuartel)'), 'tras guardar se mantiene el cuartel');
});

test('lo del mismo cuartel y el mismo día es una sola tarjeta', () => {
  const f = readFileSync(new URL('../assets/fertilizacion.js', import.meta.url), 'utf8');
  const bloque = f.slice(f.indexOf('async function cargarRecientes'), f.indexOf('function renderRecientes'));
  assert.ok(bloque.includes('const mapa=new Map()'), 'las cargas se agrupan por cuartel y fecha');
  assert.ok(bloque.includes('if(i>=0)g.filas[i]=f; else g.filas.push(f)'), 'lo del teléfono manda sobre lo de la base');
  assert.ok(bloque.includes("i.status!=='synced'"), 'solo lo que no subió se marca como pendiente');
});

test('se puede corregir y descartar lo registrado', () => {
  assert.match(fert, /function editar\(host,campo,clave\)/);
  assert.match(fert, /async function descartar\(host,campo,clave\)/);
  // Descartar nunca borra: oculta con activo=false, igual que en el resto.
  assert.ok(fert.includes("update({activo:false,actualizado_por:session.user.id})"));
  assert.ok(!/\.delete\(\)/.test(fert), 'nada de borrar filas de la base');
});

test('rellenar la lista de cuarteles ya no desmarca el que está elegido', () => {
  const f = cal.slice(cal.indexOf('function fillQuarters()'), cal.indexOf('async function loadProfile()'));
  assert.ok(f.includes("const elegido=$('#cuartelId')?.value||''"), 'hay que recordar lo elegido');
  assert.ok(f.includes('const sigue=id=>id&&quarters.some(q=>q.id===id)'), 'solo se repone si el cuartel sigue en la lista');
  assert.ok(f.includes("if(sigue(elegido))$('#cuartelId').value=elegido"));
  assert.ok(f.includes("if(sigue(historial))$('#historyQuarter').value=historial"));
});

/* ---------- Confirmar el programa de la planilla ---------- */
const prog = readFileSync(new URL('../assets/fertilizacion.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/202610130001_programa_fertilizacion.sql', import.meta.url), 'utf8');
const script = readFileSync(new URL('../docs/fertilizacion/subir-programa.gs', import.meta.url), 'utf8');
const func = readFileSync(new URL('../supabase/functions/programa-fertilizacion/index.ts', import.meta.url), 'utf8');

test('el programa se busca por fecha, no por número de semana', () => {
  // Dos aplicaciones del mismo cuartel pueden caer en la misma semana del mes
  // (23 y 28 de octubre): la semana solo sirve de rótulo.
  assert.match(prog, /function programaDeCuartel\(cuartelId,hoy\)/);
  assert.ok(prog.includes('Math.abs(diasEntre(a,hoy))-Math.abs(diasEntre(b,hoy))'),
    'se elige la fecha programada más cercana a hoy');
  assert.ok(prog.includes('!p.aplicacion_id'), 'solo lo que nadie confirmó todavía');
  assert.match(prog, /function rotuloSemana\(fecha\)/);
  assert.ok(prog.includes('semana ${semanaDelMes(f)}'), 'el rótulo usa la semana del mes, como la planilla');
});

test('las tres respuestas quedan registradas, incluida la de no aplicar', () => {
  for (const r of ['igual', 'cambio', 'no']) assert.ok(prog.includes(`data-resp="${r}"`), `falta la respuesta ${r}`);
  assert.ok(prog.includes("estado:f.respuesta==='no'?'no_aplicado':'aplicado'"));
  assert.ok(prog.includes("cantidad:f.respuesta==='no'?0:num(f.cantidad)"));
  assert.ok(prog.includes('plan_id:f.plan_id'), 'cada confirmación queda amarrada a su línea del programa');
  // En la base: cantidad 0 solo se acepta cuando el estado lo explica.
  assert.match(sql, /check \(cantidad >= 0 and \(estado = 'no_aplicado' or cantidad > 0\)\)/);
  assert.match(sql, /where a\.activo and a\.estado = 'aplicado'/);
});

test('cambiar de cuartel no deja la fecha ni el programa del anterior', () => {
  assert.ok(prog.includes('st.programaPara=st.cuartel_id'));
  assert.ok(prog.includes('else if(st.fechaDelPrograma){st.fecha=localDate();st.fechaDelPrograma=false}'));
  assert.ok(prog.includes('if(state.programaPara!==state.cuartel_id)aplicarPrograma(state)'));
});

test('el programa se puede volver a subir sin duplicar ni perder lo borrado', () => {
  assert.match(sql, /create unique index if not exists fert_plan_fecha_idx\s+on public\.fert_plan \(cuartel_id, producto_id, fecha, temporada\);/);
  assert.ok(func.includes('onConflict: "cuartel_id,producto_id,fecha,temporada"'));
  assert.ok(func.includes('activo: false'), 'lo que se sacó de la planilla se da de baja');
  assert.ok(!/\.delete\(\)/.test(func), 'la función nunca borra filas');
  assert.ok(func.includes('iguales(enviado, syncSecret)'), 'el secreto se compara en tiempo constante');
});

test('la planilla sube el programa con su propio botón', () => {
  assert.ok(script.includes("createMenu('Agrícola Yoye')"));
  assert.ok(script.includes('X-Yoye-Sync-Secret'));
  assert.ok(script.includes('function temporadaDe_'), 'la temporada sale de la fecha de cada columna');
  assert.ok(script.includes('PRODUCTOS ADICIONALES'), 'el bloque de extras no se confunde con el programa');
  assert.ok(script.includes('previsualizarPrograma'), 'se puede ver qué se va a subir antes de subirlo');
});

test('la equivalencia hoja → cuartel se guarda, no se adivina', () => {
  const mapa = readFileSync(new URL('../supabase/migrations/202610130002_fert_hoja_cuartel.sql', import.meta.url), 'utf8');
  assert.match(mapa, /create table if not exists public\.fert_hoja_cuartel/);
  assert.ok(mapa.includes("['29','C-29 antiguo']"), 'los cuarteles duplicados necesitan la equivalencia explícita');
  assert.ok(mapa.includes("['nogales 15','C-15']"));
  assert.ok(func.includes('fert_hoja_cuartel'), 'la función lee la equivalencia de la base');
  assert.ok(func.includes('sin_cuartel'), 'las hojas sin cuartel se avisan en vez de perderse');
});
