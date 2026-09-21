import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const campos = readFileSync(new URL('../assets/campos.js', import.meta.url), 'utf8');
const cal = readFileSync(new URL('../assets/calicatas.js', import.meta.url), 'utf8');

test('los campos de respaldo traen su id real (sin señal igual se filtra por campo)', () => {
  for (const id of ['80aceca7-e61a-441a-b803-d60496a3d36f','00373fa7-274e-4c95-893a-81497b2c100b',
                    '4bfa28ed-481f-4f0f-8d32-813bfae69849','108e3908-ba2a-4e07-b66b-80e074c787dd'])
    assert.ok(campos.includes(`{id:'${id}',slug:`), id);
  assert.match(campos, /yoye_campos_cache/);
  assert.match(campos, /try\{\(\{data,error\}=await db\.from\('campos'\)/);
});

test('Calicatas descarta cuarteles de otro campo antes de llenar el selector', () => {
  assert.match(cal, /select\('id,organizacion_id,campo_id,/);
  assert.match(cal, /function fillQuarters\(\)\{quarters=delCampo\(quarters\)/);
});
