import fs from 'node:fs/promises';
import { extractAuthorReplyIdsFromSsr } from '../config/ssr-author-replies.mjs';

const elsa = await fs.readFile('tests/target-elsa-status-logged-out.html', 'utf8');
const noor = await fs.readFile('tests/target-status-logged-out.html', 'utf8');

console.log(JSON.stringify({
  elsa: extractAuthorReplyIdsFromSsr(elsa, 'ElsaSofia__AI'),
  noor: extractAuthorReplyIdsFromSsr(noor, 'Noor_ul_ain43'),
}, null, 2));
