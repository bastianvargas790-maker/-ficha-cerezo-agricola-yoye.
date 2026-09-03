import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const officialLogo = new URL('../assets/yoye-logo-official.png', import.meta.url);
const auth = readFileSync(new URL('../assets/shared-auth.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../calicatas/sw.js', import.meta.url), 'utf8');
const pages = ['index.html', 'registro.html', 'registro-v16.html'].map(name =>
  readFileSync(new URL(`../calicatas/${name}`, import.meta.url), 'utf8')
);

// La versión no se fija a mano: se lee de una fuente y se exige que el resto
// coincida. Así un bump de versiones no rompe el test, pero un desajuste sí.
const versionOf = (source, asset) => {
  const match = source.match(new RegExp(`${asset}\\?v=([0-9a-zA-Z-]+)`));
  return match && match[1];
};

test('the official Yoye logo is used by authentication and Calicatas', () => {
  assert.ok(existsSync(officialLogo));

  const logoVersion = versionOf(auth, 'yoye-logo-official\\.png');
  assert.ok(logoVersion, 'shared-auth.js debe pedir el logo oficial con versión');

  const authVersion = versionOf(pages[0], 'shared-auth\\.js');
  assert.ok(authVersion, 'las páginas deben pedir shared-auth.js con versión');

  for (const page of pages) {
    assert.equal(versionOf(page, 'shared-auth\\.js'), authVersion);
    assert.equal(versionOf(page, 'yoye-logo-official\\.png'), logoVersion);
  }
  assert.equal(versionOf(serviceWorker, 'yoye-logo-official\\.png'), logoVersion);
  assert.match(serviceWorker, /const CACHE='calicatas-campo-v[0-9a-zA-Z-]+'/);
});
