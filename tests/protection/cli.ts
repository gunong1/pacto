/**
 * 통합 테스트 도우미 (jest에서 별도 프로세스로 실행): 테스트 PDF 만들기 · PDF 텍스트 추출(pdf.js)
 *   node --experimental-strip-types tests/protection/cli.ts make <employment|rental|scan|scan-lease|scan-mixed|scan-ccitt|cmap|repeated|type3> <out.pdf>
 *     scan: 1×1 흰 이미지 + 숨은 글자층 (읽을 글자 없음 → unreadable) / scan-lease: 임대차계약서 스캔(A4, 숨은 OCR 글자층 포함)
 *     scan-mixed: 텍스트 페이지 + scan-lease / scan-ccitt: 특수 형식(CCITT) 스캔 → unsupported_scan
 *   node --experimental-strip-types tests/protection/cli.ts text <in.pdf>
 *   node --experimental-strip-types tests/protection/cli.ts diagnose <in.pdf>   (상태·진단 숫자만 — 원문 출력 없음)
 */
import fs from 'node:fs';

import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { extractPage, type StreamEntry } from '../../supabase/functions/_shared/protection/pdfEngine.ts';
import { isAxisAligned, pageCoverage } from '../../supabase/functions/_shared/protection/scanGeometry.ts';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf, employmentContractPdf, rentalContractPdf } from './fixtures.ts';
import { buildPdf, readFix, type PageSpec } from './scanFixtures.ts';

/** 임대차계약서 스캔 페이지 (lease-a4 2400×3391 JPEG, 숨은 OCR 글자층: 주민등록번호를 이미지와 같은 자리에) */
export const leaseScanPage = (): PageSpec => ({
  size: [595, 842],
  image: { bytes: readFix('lease-a4.jpg'), width: 2400, height: 3391 },
  hidden: [['주민등록번호', 190, 660.5, 10], ['800101-1234567', 300, 660.5, 10]],
});
import { predefinedCMapPdf, simpleFontValuesPdf, type3ValuesPdf } from './lowlevel.ts';

/** 반복 숫자 (카드·전화가 같은 숫자 조각 공유) */
export const REPEATED_VALUES: [string, string][] = [
  ['카드번호:', '4111-1111-1111-1111'],
  ['법인카드 번호:', '5500-0000-0008-1111'],
  ['휴대전화:', '010-2222-1111'],
  ['연락처:', '010-1234-5678'],
  ['비상연락처:', '010-1234-9876'],
];
export const CMAP_LINES = ['주민등록번호: 900101-1234567', '휴대전화: 010-1234-5678', '카드번호: 4111-1111-1111-1111'];

const [cmd, kind, file] = process.argv.slice(2);
if (cmd === 'make') {
  let bytes: Uint8Array;
  if (kind === 'employment') bytes = await employmentContractPdf();
  else if (kind === 'rental') bytes = await rentalContractPdf();
  else if (kind === 'cmap') bytes = await predefinedCMapPdf('UniKS-UCS2-H', CMAP_LINES);
  else if (kind === 'repeated') bytes = await simpleFontValuesPdf(REPEATED_VALUES);
  else if (kind === 'type3') bytes = await type3ValuesPdf(REPEATED_VALUES);
  else if (kind === 'scan-lease' || kind === 'scan-mixed') {
    const c = await ContractPdf.create();
    if (kind === 'scan-mixed') await c.page(['근로계약서', '근로자: 박민준', '주민등록번호: 901225-1234567']);
    bytes = await buildPdf([leaseScanPage()], (s) => c.font(s), c.doc);
  } else if (kind === 'scan-ccitt') {
    bytes = await buildPdf([{ size: [595, 842], image: { bytes: new Uint8Array(64), width: 1700, height: 2400, filter: 'CCITTFaxDecode', colorSpace: 'DeviceGray', bpc: 1 } }]);
  } else {
    const c = await ContractPdf.create();
    await c.scanPage('901225-1234567');
    bytes = await c.save();
  }
  fs.writeFileSync(file, bytes);
} else if (cmd === 'text') {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(fs.readFileSync(kind)), PDFJS_OPTIONS as never), { mergePages: true });
  process.stdout.write(String(text));
} else if (cmd === 'diagnose') {
  // 파일을 서버로 보내지 않고 이 PC에서 보호 처리를 그대로 실행해 단계별 결과만 출력한다
  // (OCR은 하지 않는다 — 스캔 페이지로 판단되면 scan:failed(ocr_not_configured)로 나오는 것이 정상, 특수 형식이면 unsupported(scan_format 등))
  const bytes = new Uint8Array(fs.readFileSync(kind));
  const r = await protectPdf(bytes);
  // 이미지 형식 (스캔 페이지 판단 근거 — 형식 이름·크기·덮는 비율만, 내용 없음)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const streams = new Map<string, StreamEntry>();
  const show = (o: unknown): unknown => {
    if (o instanceof PDFName) return o.asString();
    if (o instanceof PDFNumber) return o.asNumber();
    if (o instanceof PDFArray) return Array.from({ length: o.size() }, (_, k) => show(o.lookup(k)));
    if (o instanceof PDFStream) return `stream(${show(o.dict.lookup(PDFName.of('N'))) ?? ''})`;
    if (o instanceof PDFDict) return Object.fromEntries([...o.entries()].map(([k, v]) => [k.asString(), show(o.context.lookup(v))]));
    return o === undefined ? undefined : String(o);
  };
  const images = Array.from({ length: doc.getPageCount() }, (_, i) => {
    const p = extractPage(doc, i, streams);
    return p.placements.map((pl) => {
      const xo = pl.ref ? doc.context.lookup(pl.ref) : null;
      const d = xo instanceof PDFStream ? xo.dict : null;
      const get = (k: string) => (d ? show(d.lookup(PDFName.of(k))) : undefined);
      return {
        page: i + 1,
        inline: pl.inline,
        filter: get('Filter'),
        colorSpace: get('ColorSpace'),
        bitsPerComponent: get('BitsPerComponent'),
        width: get('Width'),
        height: get('Height'),
        decodeParms: get('DecodeParms'),
        decode: get('Decode'),
        smask: d?.lookup(PDFName.of('SMask')) ? 'yes' : 'no',
        mask: d?.lookup(PDFName.of('Mask')) ? 'yes' : 'no',
        imageMask: get('ImageMask'),
        coverage: Math.round(pageCoverage(pl.ctm, doc.getPage(i).getCropBox()) * 1000) / 1000,
        axisAligned: isAxisAligned(pl.ctm),
      };
    });
  }).flat();
  process.stdout.write(
    JSON.stringify(
      { status: r.status, detail: r.detail, pages: r.pages.map((p) => `${p.page}:${p.kind}:${p.status}${p.detail ? `(${p.detail})` : ''}`), images, regionTypes: r.regions.map((x) => `${x.type}:${x.confidence}:${x.state}`), ...r.diagnostics },
      null,
      2,
    ) + '\n',
  );
}
