import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const leer = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('la pantalla de acceso encuentra el logo en cualquier publicación', () => {
  // Contando segmentos del path, servido en la raíz de un dominio pedía
  // /paneles/assets/yoye-logo-official.png y devolvía 404.
  const js = leer('../assets/shared-auth.js');
  assert.match(js, /assets\\\/shared-auth\\\.js/, 'la raíz se deduce del propio script');
  assert.match(js, /new URL\(m\[1\],location\.href\)\.pathname/);
});

test('volver desde un panel es un toque cómodo', () => {
  assert.match(leer('../assets/paneles-dashboards.css'), /\.pd-volver\{[^}]*min-height:44px/);
});

test('cada alerta del panel dice de qué cuartel y fecha habla', () => {
  const js = leer('../assets/paneles-dashboards.js');
  assert.match(js, /cuartel:cuartelDe\(cal\)\.codigo\|\|'—',fecha:cal\.fecha/);
  assert.match(js, /pd-diag-alerta"><b>\$\{esc\(p\.cuartel\)\} · \$\{fecha\(p\.fecha\)\}/);
});
