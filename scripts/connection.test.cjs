const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/connection.ts');
test('retired company deployment settings always migrate to the current user-supplied URL', async () => {
  const { defaultBackendUrl, retiredDeploymentIds, resolveBackendUrl } = await loaded;
  for (const id of retiredDeploymentIds) assert.equal(resolveBackendUrl(`https://script.google.com/macros/s/${id}/exec`), defaultBackendUrl);
  for (const value of ['', undefined, 'invalid', 'https://example.com/backend']) assert.equal(resolveBackendUrl(value), defaultBackendUrl);
});
test('an intentional new deployment override remains available', async () => {
  const { resolveBackendUrl } = await loaded;
  const alternate = 'https://script.google.com/macros/s/new-company-deployment/exec';
  assert.equal(resolveBackendUrl(` ${alternate} `), alternate);
});
