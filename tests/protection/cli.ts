/**
 * 통합 테스트 도우미 (jest에서 별도 프로세스로 실행): 테스트 PDF 만들기 · PDF 텍스트 추출(pdf.js)
 *   node --experimental-strip-types tests/protection/cli.ts make <employment|rental|scan> <out.pdf>
 *   node --experimental-strip-types tests/protection/cli.ts text <in.pdf>
 */
import fs from 'node:fs';

import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf, employmentContractPdf, rentalContractPdf } from './fixtures.ts';

const [cmd, kind, file] = process.argv.slice(2);
if (cmd === 'make') {
  let bytes: Uint8Array;
  if (kind === 'employment') bytes = await employmentContractPdf();
  else if (kind === 'rental') bytes = await rentalContractPdf();
  else {
    const c = await ContractPdf.create();
    await c.scanPage('901225-1234567');
    bytes = await c.save();
  }
  fs.writeFileSync(file, bytes);
} else if (cmd === 'text') {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(fs.readFileSync(kind))), { mergePages: true });
  process.stdout.write(String(text));
}
