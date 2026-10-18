import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadObsidianStyleContract } from '../scripts/obsidian-style.mjs';

test('X-case onboarding derives CSS names and URL from tracked consumer contract', async () => {
  const contract = await loadObsidianStyleContract();
  assert.deepEqual(contract.snippets, ['learning-lab', 'x-case-note']);
  assert.ok(contract.repository.startsWith('https://github.com/'));
});

test('consumer style contract accepts a renamed provider and rejects path traversal', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'x-style-contract-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'style.json');
  const sample = {
    schema_version: 1,
    repository: 'https://github.com/ZiYao00/new-css-provider-name',
    core: 'snippets/learning-lab.css',
    extensions: ['snippets/x-case-note.css', 'snippets/custom-extension.css'],
    cssclasses: ['learning-page', 'x-case-note'],
  };
  await fs.writeFile(file, JSON.stringify(sample));
  const resolved = await loadObsidianStyleContract(file);
  assert.equal(resolved.repository, sample.repository);
  assert.deepEqual(resolved.snippets, ['learning-lab', 'x-case-note', 'custom-extension']);

  sample.extensions[1] = 'snippets/../unsafe.css';
  await fs.writeFile(file, JSON.stringify(sample));
  await assert.rejects(loadObsidianStyleContract(file), /unsafe CSS filename/);
});
