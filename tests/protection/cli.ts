/**
 * 통합 테스트 도우미 (jest에서 별도 프로세스로 실행): 테스트 PDF 만들기 · PDF 텍스트 추출(pdf.js)
 *   node --experimental-strip-types tests/protection/cli.ts make <employment|rental|scan> <out.pdf>
 *   node --experimental-strip-types tests/protection/cli.ts text <in.pdf>
 *   node --experimental-strip-types tests/protection/cli.ts diagnose <in.pdf>   (상태·진단 숫자만 — 원문 출력 없음)
 */
import fs from 'node:fs';

import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
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
} else if (cmd === 'diagnose') {
  // 파일을 서버로 보내지 않고 이 PC에서 보호 처리를 그대로 실행해 단계별 결과만 출력한다
  const r = await protectPdf(new Uint8Array(fs.readFileSync(kind)));
  process.stdout.write(
    JSON.stringify(
      { status: r.status, detail: r.detail, regionTypes: r.regions.map((x) => `${x.type}:${x.confidence}:${x.state}`), ...r.diagnostics },
      null,
      2,
    ) + '\n',
  );
}
