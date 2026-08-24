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
const validationScript = readFileSync(new URL('../scripts/validar-migracion-aforos.mjs', import.meta.url), 'utf8');

test('Supabase client and IndexedDB handle use separate variables from the start', () => {
  assert.match(app, /let sb, localDb, session/);
  assert.doesNotMatch(app, /\bdb\b\s*=\s*request\.result/);
});

test('aforo.js delegates caudal/CU math to the shared formulas module instead of reimplementing it', () => {
  assert.match(app, /const F = globalThis\.YOYE_AFORO_FORMULAS/);
  assert.doesNotMatch(app, /q25 \/ qMedio/); // la fórmula real vive solo en aforo-formulas.js
  assert.match(html, /aforo-formulas\.js/);
});

test('the shared formula module implements caudal, q_medio, q_25, CU, classification and the override rule exactly once', async () => {
  assert.match(formulas, /function calcularCaudal\(/);
  assert.match(formulas, /function calcularQMedio\(/);
  assert.match(formulas, /function calcularQ25\(/);
  assert.match(formulas, /function calcularCU\(/);
  assert.match(formulas, /function clasificarCU\(/);
  assert.match(formulas, /function resolverTiempoEfectivo\(/);
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

test('resolverTiempoEfectivo: caso normal usa el tiempo general del aforo', async () => {
  await import('../assets/aforo-formulas.js');
  const F = globalThis.YOYE_AFORO_FORMULAS;
  assert.equal(F.resolverTiempoEfectivo(null, 36), 36);
  assert.equal(F.resolverTiempoEfectivo(undefined, 36), 36);
});

test('resolverTiempoEfectivo: caso histórico excepcional usa el override, no el tiempo general', async () => {
  await import('../assets/aforo-formulas.js');
  const F = globalThis.YOYE_AFORO_FORMULAS;
  assert.equal(F.resolverTiempoEfectivo(32, 36), 32);
});

test('the anomalous AF-2025-014 reading reproduces its historical CU once tiempo_s_override is applied', async () => {
  // 16 lecturas reales de AF-2025-014 (cuartel 27): la posición "Línea 2,
  // Último" fue capturada con 32s en vez de los 36s declarados para el resto
  // del aforo. CU histórico real: 85.51068883610452%.
  await import('../assets/aforo-formulas.js');
  const F = globalThis.YOYE_AFORO_FORMULAS;
  const volumenes = [21, 28, 24, 30, 21, 28, 25, 32, 29, 24, 24, 25, 28, 24, 29, 25];
  const overrideIndex = 7; // L2_Ult
  const lecturas = volumenes.map((volumen_ml, i) => ({
    volumen_ml,
    tiempo_s: F.resolverTiempoEfectivo(i === overrideIndex ? 32 : null, 36),
  }));
  const resultado = F.calcularResultado(lecturas);
  assert.ok(Math.abs(resultado.cu - 85.51068883610452) < 0.01, `CU recalculado (${resultado.cu}) debería reproducir el histórico`);
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
  assert.doesNotMatch(html, /tiempo_s_override|afOverride/i); // no se expone en la interfaz de captura
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

test('the Supabase migration adds tiempo_s_override without reintroducing a rigid tiempo_s per reading', () => {
  assert.match(migration, /create table if not exists public\.aforos/);
  assert.match(migration, /create table if not exists public\.aforo_lecturas/);
  assert.match(migration, /unidad_aforo text/);
  assert.match(migration, /tiempo_medicion_s numeric/);
  assert.match(migration, /tiempo_s_override numeric/);
  assert.doesNotMatch(migration, /aforo_lecturas[\s\S]*?\n\s*tiempo_s numeric/); // se movió a aforos, y no reaparece per-lectura sin "_override"
  assert.match(migration, /migracion_lote uuid/);
  assert.match(migration, /actualizado_por = \(select auth\.uid\(\)\)\);/); // RLS de UPDATE en aforos
  assert.match(migration, /references public\.organizaciones\(id\)/);
  assert.match(migration, /create trigger auditar_aforos/);
  assert.match(migration, /unique \(aforo_id, linea, posicion\)/); // única defensa real contra lecturas duplicadas
});

test('the migration script recalculates from raw readings instead of trusting DB_Aforos precomputed totals', () => {
  assert.match(migrationScript, /import aforoFormulas from '\.\.\/assets\/aforo-formulas\.js'/);
  assert.match(migrationScript, /resolverTiempoEfectivo/);
  assert.match(migrationScript, /calcularResultado\(/);
  assert.match(migrationScript, /onConflict: 'legacy_id'/); // idempotencia: 2 corridas = 1 sola fila
  assert.match(migrationScript, /onConflict: 'aforo_id,linea,posicion'/); // idempotencia de lecturas
  assert.match(migrationScript, /migracion_lote: loteId/);
});

test('the migration script excludes the confirmed test record and unresolved historical cases', () => {
  assert.match(migrationScript, /'AF-2026-001':/); // prueba confirmada
  assert.match(migrationScript, /'AF-2025-030':/); // 13A (pendiente)
  assert.match(migrationScript, /'AF-2025-031':/); // 13B (pendiente)
  assert.match(migrationScript, /'AF-2025-032':/); // 34 (pendiente)
});

test('14A/14B are now migrable as confirmed independent cuarteles in public.cuarteles', () => {
  // Confirmado directamente por Bastián el 23-08-2026: C-14A (Lapins, 1.84 ha)
  // y C-14B (Santina, 1.03 ha) existen como cuarteles independientes.
  assert.match(migrationScript, /'14A': \{ cuartelCodigo: 'C-14A' \}/);
  assert.match(migrationScript, /'14B': \{ cuartelCodigo: 'C-14B' \}/);
});

test('C-40 stays a single cuartel with two aforo units, not two separate cuarteles', () => {
  assert.match(migrationScript, /'40 A': \{ cuartelCodigo: 'C-40', unidadAforo: 'A' \}/);
  assert.match(migrationScript, /'40B': \{ cuartelCodigo: 'C-40', unidadAforo: 'B' \}/);
});

test('the validation script recomputes results and checks for duplicate aforos and duplicate lecturas separately', () => {
  assert.match(validationScript, /resolverTiempoEfectivo/);
  assert.match(validationScript, /calcularResultado\(/);
  assert.match(validationScript, /tipo: 'aforo'/);
  assert.match(validationScript, /tipo: 'lectura'/);
  assert.match(validationScript, /cuReproducible/);
});
