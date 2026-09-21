import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');
const pan = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');

// Réplica de averages() para comprobar el cálculo con la C-5 del 21/09.
const src = cal.match(/function avg\(readings,field,depth\)\{.*?\}(?=\n|  )/s)[0] + '\n' +
            cal.match(/function averages\(readings\)\{.*?return \{by,byCe,byTemp,total:media\(by\),ce:media\(byCe\),temp:media\(byTemp\)\}\}/s)[0];
const isNumber = v => v !== null && v !== '' && Number.isFinite(Number(v));
const averages = new Function('isNumber', src + '\nreturn averages;')(isNumber);

test('total de la calicata = promedio de las profundidades (cada una, promedio de 3 puntos)', () => {
  const H=[19,20,24,24,26,23,23,19,23], C=[.4,.8,.6,.9,.9,.9,1.5,1.1,1.5];
  const r = H.map((h,i)=>({profundidad_cm:[30,60,90][Math.floor(i/3)],humedad_pct:h,ce_ms_cm:C[i],temperatura_c:20,estado:'medida'}));
  const av = averages(r);
  assert.equal(av.by[30].toFixed(2),'21.00'); assert.equal(av.by[60].toFixed(2),'24.33');
  assert.equal(av.total.toFixed(2),'22.33'); assert.equal(av.ce.toFixed(2),'0.96'); assert.equal(av.temp,20);
});

test('una profundidad con un punto no realizado pesa igual que las demás', () => {
  const r=[{profundidad_cm:30,humedad_pct:10,estado:'medida'},{profundidad_cm:30,humedad_pct:30,estado:'no_realizada'},
           {profundidad_cm:60,humedad_pct:20,estado:'medida'},{profundidad_cm:60,humedad_pct:40,estado:'medida'}];
  assert.equal(averages(r).total,20); // (10 + 30)/2, no (10+20+40)/3
});

test('los totales se muestran al guardar, en el resumen y en Paneles', () => {
  assert.match(html, /class="guardada-totales"/);
  assert.match(cal, /Humedad total: \$\{fmtPct\(av\.total\)\}/);
  assert.match(pan, /'Totales por calicata'/);
  assert.match(pan, /class="pd-totales">Total:/);
});

test('los indicadores de Paneles usan el total, no una profundidad suelta', () => {
  const bloque = pan.slice(pan.indexOf('function pintarCalicatas'), pan.indexOf('/* ---------- Ácido'));
  assert.ok(!/kpi\(`(Humedad|CE) a \$\{/.test(bloque), 'no debe quedar "Humedad a 90 cm" ni "CE a 90 cm"');
  for (const t of ["'Humedad total'","'CE total'","'Temperatura total'"]) assert.ok(bloque.includes(t), t);
});
