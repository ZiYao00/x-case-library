/** Style contract is a checked-in dependency declaration, not a source-directory path. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONTRACT = fileURLToPath(new URL('../config/obsidian-style.json', import.meta.url));

export async function loadObsidianStyleContract(file = DEFAULT_CONTRACT) {
  const raw = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (raw.schema_version !== 1 || typeof raw.repository !== 'string' || !raw.repository.trim()) {
    throw new Error('Invalid Obsidian style contract schema or provider identity');
  }
  if (typeof raw.core !== 'string' || !Array.isArray(raw.extensions) ||
      !Array.isArray(raw.cssclasses) || raw.cssclasses.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('Invalid Obsidian style core, extensions, or cssclasses');
  }
  const declared = [raw.core, ...raw.extensions];
  if (!declared.every((file) => typeof file === 'string' && /^snippets\/[A-Za-z0-9-]+\.css$/.test(file))) {
    throw new Error('Obsidian style contract has an unsafe CSS filename');
  }
  const snippets = declared.map((file) => file.slice('snippets/'.length, -'.css'.length));
  if (new Set(snippets).size !== snippets.length) throw new Error('Duplicate Obsidian CSS names');
  return { repository: raw.repository, snippets, cssclasses: raw.cssclasses };
}
