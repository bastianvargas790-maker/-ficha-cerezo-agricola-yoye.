import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../assets/aforo.js', import.meta.url), 'utf8');
const formulas = readFileSync(new URL('../assets/aforo-formulas.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/aforo.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../aforo-rinconada/index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../aforo-rinconada/sw.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/202608231_aforo_rinconada.sql', import.meta.url), 'utf8');
const migrationScript = readFileSync(new URL('../scripts/migrar-aforos-historicos.mjs', import.meta.url), 'utf8');

test('Supabase client and IndexedDB handle use separate variables from the start', () => {
  assert.match(app, /let sb, localDb, session/);
  assert.doesNotMatch(app, /\bdb\b\s*=\s*request\.result/);
});

test('aforo.js delegates caudal/CU math to the shared formulas module instead of reimplementing it', () => {
  assert.match(app, /const F = globalThis\.YOYE_AFORO_FORMULAS/);
  assert.doesNotMatch(app, /q25 \/ qMedio/); // la fórmula real vive solo en aforo-formulas.js
  assert.match(html, /aforo-formulas\.js/);
});

test('the shared formula module implements caudal, q_medio, q_25, CU and classification exactly once', async () => {
  assert.match(formulas, /function calcularCaudal\(/);
  assert.match(formulas, /function calcularQMedio\(/);
  assert.match(formulas, /function calcularQ25\(/);
  assert.match(formulas, /function calcularCU\(/);
  assert.match(formulas, /function clasificarCU\(/);
  assert.match(formulas, /\(v \* 3\.6\) \/ t/); // caudal_l_h = volumen_ml * 3.6 / tiempo_s
  assert.match(formulas, /\(q25 \/ qMedio\) \* 100/);

  // Ejercitar el módulo real con los 16 valores reales de AF-2025-001 (cuartel 6)
  // verificados contra DB_Aforos el 23-08-2026, para no solo comprobar texto.
  await import('../assets/aforo-formulas.js');
  const F = globalThis.YOYE_AFORO_FORMULAS;
  const volumenes = [25, 31, 30, 32, 24, 28, 35, 34, 30, 39, 27, 40, 29, 32, 28, 35];
  const lecturas = volumenes.map(volumen_ml => ({ volumen_ml, tiempo_s: 36 }));
  const resultado = F.calcularResultado(lecturas);
  assert.ok(Math.abs(resultado.qMedio - 3.11875) < 0.0001);
  assert.ok(Math.abs(resultado.q25 - 2.6) < 0.0001);
  assert.ok(Math.abs(resultado.cu - 83.36673346693388) < 0.0001);
  assert.equal(resultado.clasificacion, 'Bueno');
});

test('classification thresholds (90/80/70) reproduce all 4 historical labels', async () => {
  await import('../assets/aforo-formulas.js');
  const F = globalThis.YOYE_AFORO_FORMULAS;
  assert.equal(F.clasificarCU(97.4), 'Excelente');
  assert.equal(F.clasificarCU(90), 'Excelente');
  assert.equal(F.clasificarCU(89.01), 'Bueno');
  assert.equal(F.clasificarCU(80), 'Bueno');
  assert.equal(F.clasificarCU(76.19), 'Medio');
  assert.equal(F.clasificarCU(70), 'Medio');
  assert.equal(F.clasificarCU(68.85), 'Bajo');
});

test('the 16-measurement matrix covers 4 lines x 4 positions, with one shared time per aforo', () => {
  assert.match(app, /LINEAS = \[1, 2, 3, 4\]/);
  assert.match(app, /POSICIONES = \[\['inicio'.*\['ultimo'/);
  assert.match(html, /id="afTiempoMedicion"/);
  assert.doesNotMatch(app, /class="tiempo"/); // ya no hay un input de tiempo por celda
});

test('index.html, service worker and asset versions stay in sync', () => {
  ['aforo.js?v=20260823-2', 'aforo.css?v=20260823-2', 'aforo-formulas.js?v=20260823-2'].forEach(version => {
    assert.ok(html.includes(version), `index.html should request ${version}`);
  });
  ['aforo.js?v=20260823-2', 'aforo.css?v=20260823-2', 'aforo-formulas.js?v=20260823-2'].forEach(version => {
    assert.ok(serviceWorker.includes(version), `sw.js should precache ${version}`);
  });
});

test('the app reuses the shared Yoye auth gate, not a bespoke login', () => {
  assert.match(html, /shared-auth\.js\?v=20260821-official-logo-1/);
  assert.match(app, /yoye-auth-ready/);
});

test('CU result styling covers all 4 historical classification levels', () => {
  ['cu-excelente', 'cu-bueno', 'cu-medio', 'cu-bajo'].forEach(clase => {
    assert.match(css, new RegExp(`\\.result-card\\.${clase} b`));
    assert.match(css, new RegExp(`\\.history-cu\\.${clase}`));
  });
});

test('the Supabase migration models unidad_aforo without creating fake sub-cuarteles', () => {
  assert.match(migration, /create table if not exists public\.aforos/);
  assert.match(migration, /create table if not exists public\.aforo_lecturas/);
  assert.match(migration, /unidad_aforo text/);
  assert.match(migration, /tiempo_medicion_s numeric/);
  assert.doesNotMatch(migration, /aforo_lecturas[\s\S]*tiempo_s numeric/); // se movió a aforos
  assert.match(migration, /migracion_lote uuid/);
  assert.match(migration, /actualizado_por = \(select auth\.uid\(\)\)\);/); // RLS de UPDATE en aforos
  assert.match(migration, /references public\.organizaciones\(id\)/);
  assert.match(migration, /create trigger auditar_aforos/);
  assert.match(migration, /unique \(aforo_id, linea, posicion\)/);
});

test('the migration script excludes the confirmed test record and the 3 unresolved historical cases', () => {
  assert.match(migrationScript, /'AF-2026-001':/);
  assert.match(migrationScript, /'AF-2025-030':/); // 13A
  assert.match(migrationScript, /'AF-2025-031':/); // 13B
  assert.match(migrationScript, /'AF-2025-032':/); // 34
  assert.match(migrationScript, /onConflict: 'legacy_id'/);
  assert.match(migrationScript, /migracion_lote: loteId/);
});

test('14A and 14B are treated as independent cuarteles, not aforo units of one plot', () => {
  assert.match(migrationScript, /'14A': \{ cuartelCodigo: 'C-14A' \}/);
  assert.match(migrationScript, /'14B': \{ cuartelCodigo: 'C-14B' \}/);
});

test('C-40 stays a single cuartel with two aforo units, not two separate cuarteles', () => {
  assert.match(migrationScript, /'40 A': \{ cuartelCodigo: 'C-40', unidadAforo: 'A' \}/);
  assert.match(migrationScript, /'40B': \{ cuartelCodigo: 'C-40', unidadAforo: 'B' \}/);
});
