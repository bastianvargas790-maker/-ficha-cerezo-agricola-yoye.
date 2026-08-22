import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const officialLogo = new URL('../assets/yoye-logo-official.png', import.meta.url);
const auth = readFileSync(new URL('../assets/shared-auth.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../calicatas/sw.js', import.meta.url), 'utf8');
const pages = ['index.html', 'registro.html', 'registro-v16.html'].map(name =>
  readFileSync(new URL(`../calicatas/${name}`, import.meta.url), 'utf8')
);

test('the official Yoye logo is used by authentication and Calicatas', () => {
  assert.ok(existsSync(officialLogo));
  assert.ok(auth.includes('yoye-logo-official.png?v=20260821-official-logo-1'));
  for (const page of pages) {
    assert.ok(page.includes('shared-auth.js?v=20260821-official-logo-1'));
    assert.ok(page.includes('yoye-logo-official.png?v=20260821-official-logo-1'));
  }
  assert.ok(serviceWorker.includes('yoye-logo-official.png?v=20260821-official-logo-1'));
  assert.ok(serviceWorker.includes('calicatas-campo-v23-official-logo'));
});
