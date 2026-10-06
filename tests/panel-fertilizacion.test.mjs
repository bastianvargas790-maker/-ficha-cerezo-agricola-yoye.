import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const paneles = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const campos = readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8');

test('el apartado de fertilización existe y aparece solo donde está habilitado', () => {
  assert.match(campos, /\{mod:'fertilizacion',icon:'🧪',k:'Nutrición',t:'Planilla de fertilización'/);
  // El módulo se muestra por alcance del campo, como el resto: nada de excepciones por slug.
  assert.match(campos, /items=panelesData\(\)\.filter\(p=>tieneModulo\(campo,p\.mod\)\)/);
});

test('el panel abre por clic y por dirección', () => {
  assert.match(paneles, /fertilizacion:\{titulo:'Planilla de fertilización',kicker:'Nutrición'/);
  assert.match(paneles, /HASH_RE=\/\^#panel-\(campos\|aforos\|calicatas\|acido\|descoles\|fertilizacion\)/);
  assert.match(paneles, /'#fertilizacion':'fertilizacion'/);
  assert.match(paneles, /if\(\/#fertilizacion\/\.test\(href\)\)return 'fertilizacion'/);
});

test('el panel lee la planilla publicada, no la embebe', () => {
  const bloque = paneles.slice(paneles.indexOf('const PLANILLA_FERT='), paneles.indexOf('const PANELES='));
  // El archivo no es público: embebido quedaría en blanco para quien no tenga acceso.
  assert.ok(!/<iframe/.test(bloque), 'no debe haber iframe de la planilla');
  assert.match(bloque, /id:'1hOfTaiFVGMyRUjAyTOE0DKdoeHQZ1FzJidW5bb6Zd_A'/);
  assert.match(bloque, /acumulado:''/, 'el enlace publicado se deja declarado y vacío hasta tenerlo');
  assert.match(bloque, /dashboard:''/, 'son dos hojas: el acumulado no trae las unidades por hectárea');
  assert.match(bloque, /Falta publicar la hoja de la planilla/);
  assert.match(bloque, /Archivo → Compartir → Publicar en la web/);
  // Solo el campo que tiene planilla la muestra.
  assert.match(bloque, /campos:\['rinconada-plano'\]/);
  assert.match(bloque, /Todavía no hay planilla de/);
});

test('lee el CSV con comillas y saca caseta, equipo, especie y productos', () => {
  const bloque = paneles.slice(paneles.indexOf('function filasCsv'), paneles.indexOf('async function datosFertilizacion'));
  const api = new Function(`${bloque}; return {filasCsv,leerAcumulado,numeroCsv}`)();
  // Dos filas de título y una de agrupación antes de la cabecera real, como la hoja.
  const csv = [
    'Total Acumulado Temporada 2026-2027',
    'Kilogramos y litros totales acumulados por producto',
    ',,,,Fertilizantes minerales (kg / sector),,,Unidades / Ha',
    'Caseta,Equipo,Especie,Cuartel,Urea,Nitrato de Potasio,Calcio Chem,U.N./Ha,U.K2O/Ha,U.P2O5/Ha',
    'Nueva,1,Nogal,2,150.0,300.0,0.0,"1,250",84,24',
    'Vieja,3,Cerezo,33,12.5,525.0,180.0,56,29,14',
    ',,,,,,,,,'
  ].join('\n');
  const r = api.leerAcumulado(csv);
  assert.equal(r.length, 2, 'la fila vacía del final no entra');
  assert.equal(r[0].caseta, 'Nueva');
  assert.equal(r[0].equipo, '1');
  assert.equal(r[0].especie, 'Nogal');
  assert.equal(r[0].cuartel, '2');
  assert.deepEqual(r[0].productos, { Urea: 150, 'Nitrato de Potasio': 300 }, 'los ceros no se guardan');
  assert.equal(r[0].unidades.n, 1250, 'los miles entrecomillados se leen bien');
  assert.deepEqual(r[1].productos, { Urea: 12.5, 'Nitrato de Potasio': 525, 'Calcio Chem': 180 });
  assert.equal(api.numeroCsv('"5,237.5"'.replace(/"/g, '')), 5237.5);
  assert.equal(api.numeroCsv('Litros'), null, 'el texto no es número');
  assert.equal(api.leerAcumulado('una,hoja,cualquiera\n1,2,3'), null, 'sin columna Caseta no inventa nada');
});

test('hay un filtro por caseta, equipo y especie, y no viajan en el hash', () => {
  const bloque = paneles.slice(paneles.indexOf('function filtrosFert'), paneles.indexOf('const PANELES='));
  assert.match(bloque, /data-fert-filtro="caseta"|selectorFert\('caseta'/);
  assert.match(bloque, /selectorFert\('equipo','Equipo'/);
  assert.match(bloque, /selectorFert\('especie','Especie'/);
  assert.match(paneles, /document\.addEventListener\('change',ev=>\{\s*if\(ev\.target\.closest\('\[data-fert-filtro\]'\)\)aplicarFert\(\)/);
  assert.match(paneles, /data-fert-limpiar/);
  // En el hash rompían la ruta del panel (#panel-<modulo>), así que viven aparte.
  assert.ok(!/location\.hash=[^;]*f=/.test(paneles), 'los filtros no se escriben en el hash');
  assert.match(paneles, /let filtroFert=\{caseta:'',equipo:'',especie:''\}/);
  const f = new Function(`${paneles.slice(paneles.indexOf('let filtroFert'), paneles.indexOf('function selectorFert'))}
    ; return {filtrosFert,aplicaFiltros}`)();
  const regs = [{ caseta: 'Nueva', equipo: '2', especie: 'Cerezo' }, { caseta: 'Vieja', equipo: '2', especie: 'Cerezo' }];
  assert.equal(f.aplicaFiltros(regs, { caseta: 'Nueva', equipo: '', especie: '' }).length, 1);
  assert.equal(f.aplicaFiltros(regs, { caseta: '', equipo: '', especie: '' }).length, 2);
});

test('dibuja consumo por caseta y por equipo, y unidades por cuartel y especie', () => {
  const bloque = paneles.slice(paneles.indexOf('function pintarFertilizacion'), paneles.indexOf('const PANELES='));
  assert.match(bloque, /agrupado\('caseta','Consumo por caseta'\)/);
  assert.match(bloque, /agrupado\('equipo','Consumo por equipo'\)/);
  assert.match(bloque, /Productos más usados/);
  for (const t of ['Nitrógeno por cuartel', 'Potasio por cuartel', 'Fósforo por cuartel'])
    assert.ok(bloque.includes(t), `falta ${t}`);
  assert.match(bloque, /Nitrógeno promedio por especie/);
  // El avance mensual no está en el acumulado: se dice, no se inventa.
  assert.match(bloque, /Avance mes a mes/);
  assert.match(bloque, /está en cada hoja de cuartel, no en el acumulado/);
});

test('el estilo de los filtros tiene alto de dedo', () => {
  const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');
  assert.match(css, /\.pd-filtro select\{[^}]*min-height:44px/);
  assert.match(css, /\.pd-abrir\{[^}]*min-height:44px/);
});

test('las unidades por hectárea salen del Dashboard, no del acumulado', () => {
  // En "Total Acumulado Temporada" esas tres columnas existen pero vienen vacías.
  const bloque = paneles.slice(paneles.indexOf('function leerDashboard'), paneles.indexOf('/* Los filtros viven'));
  const api = new Function(`${paneles.slice(paneles.indexOf('function filasCsv'), paneles.indexOf('/* Los filtros viven'))}
    ; return {leerDashboard}`)();
  const csv = [
    ',AGRÍCOLA YOYE · DASHBOARD DE FERTIRRIEGO',
    ',DETALLE POR CUARTEL',
    ',Cuartel,Especie,Superficie (ha),N (kg/ha),K2O (kg/ha),P2O5 (kg/ha)',
    ',39,Cerezo,1.0,126,175,30',
    ',29,Cerezo,1.3,253,216,22',
    ',,,,,,'
  ].join('\n');
  const d = api.leerDashboard(csv);
  assert.deepEqual(Object.keys(d).sort(), ['29', '39']);
  assert.equal(d['39'].ha, 1);
  assert.deepEqual(d['39'].unidades, { n: 126, k: 175, p: 30 });
  assert.equal(api.leerDashboard('a,b\n1,2'), null);
  // Y se juntan por número de cuartel con el acumulado.
  assert.match(paneles, /if\(acumulado&&dashboard\)acumulado\.forEach/);
  assert.match(bloque, /iN=busca\(\/\^n \\\(\/i\)/);
});
