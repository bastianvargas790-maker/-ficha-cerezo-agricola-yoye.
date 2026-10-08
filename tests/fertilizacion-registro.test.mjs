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
