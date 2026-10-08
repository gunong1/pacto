/**
 * OCR spike — 같은 계약서 사진으로 CLOVA OCR(General)과 Google Vision(DOCUMENT_TEXT_DETECTION)을 비교한다.
 * 화면·로그에는 가린 값과 지표만 출력한다 (OCR 전체 글자·민감정보 원문은 출력·저장하지 않음).
 *
 * 실행 (키는 환경 변수로만, 저장소에 넣지 않는다):
 *   CLOVA_OCR_URL=<APIGW Invoke URL> CLOVA_OCR_SECRET=<Secret Key> GOOGLE_VISION_API_KEY=<API 키> \
 *   node --experimental-strip-types --no-warnings scripts/ocr-spike.ts <사진.jpg> [기대값.json]
 * 기대값 예: scripts/ocr-spike/sample-lease.expected.json (PACTO 테스트용 가상 샘플)
 * 둘 중 한 공급자의 키만 있어도 그 공급자만 실행한다.
 */
import fs from 'node:fs';

import { buildText, detectOnTokens, fromClova, fromGoogleVision, readQuality, type OcrPage } from '../supabase/functions/_shared/protection/ocrText.ts';

interface Expected {
  /** 계약서에 실제로 있는 문구 (한글 인식 확인용) */
  phrases: string[];
  /** 가려야 하는 값 — 숫자만 비교 (가상 샘플 값만 넣는다) */
  sensitive: { type: string; value: string }[];
  /** 민감정보로 가리면 안 되는 값 (오탐 확인) */
  notSensitive?: string[];
}

function imageSize(buf: Buffer): { width: number; height: number; format: 'jpg' | 'png' } {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('jpeg_parse');
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), format: 'jpg' };
    i += 2 + len;
  }
  throw new Error('jpeg_size_not_found');
}

const digits = (s: string) => s.replace(/\D/g, '');
const squash = (s: string) => s.replace(/\s+/g, '');

async function clova(buf: Buffer, format: string): Promise<unknown> {
  const res = await fetch(process.env.CLOVA_OCR_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': process.env.CLOVA_OCR_SECRET! },
    body: JSON.stringify({ version: 'V2', requestId: `spike-${Date.now()}`, timestamp: Date.now(), lang: 'ko', images: [{ format, name: 'page1', data: buf.toString('base64') }] }),
  });
  if (!res.ok) throw new Error(`clova_http_${res.status}`);
  return res.json();
}

async function vision(buf: Buffer): Promise<unknown> {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(process.env.GOOGLE_VISION_API_KEY!)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: buf.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['ko'] } }] }),
  });
  if (!res.ok) throw new Error(`vision_http_${res.status}`);
  return res.json();
}

function report(name: string, page: OcrPage, ms: number, expected: Expected | null) {
  const q = readQuality(page.tokens);
  const { text } = buildText(page.tokens);
  const ds = detectOnTokens(page.tokens);
  const out: Record<string, unknown> = {
    provider: name,
    ms,
    unit: page.tokens.some((t) => t.chars?.length) ? 'word + character' : 'field (word~phrase)',
    tokens: page.tokens.length,
    chars: q.chars,
    meanConfidence: q.meanConfidence?.toFixed(3) ?? null,
    lowConfidenceRatio: q.lowConfidenceRatio?.toFixed(3) ?? null,
    detections: ds.map((d) => ({
      type: d.detection.type,
      masked: d.detection.maskedPreview,
      tokens: d.tokens.length,
      lines: d.boxes.length,
      complete: d.complete,
      overcover: Number(d.overcover.toFixed(2)),
    })),
  };
  if (expected) {
    const flat = squash(text);
    const phraseHits = expected.phrases.filter((p) => flat.includes(squash(p)));
    out.koreanPhraseRecall = `${phraseHits.length}/${expected.phrases.length}`;
    out.missedPhrases = expected.phrases.filter((p) => !phraseHits.includes(p));
    out.sensitive = expected.sensitive.map((e) => {
      const hit = ds.find((d) => digits(text.slice(d.detection.start, d.detection.end)) === digits(e.value));
      // 하이픈 포함 값이 OCR 조각 몇 개에 걸쳤는지 (1 = 한 조각)
      return { type: e.type, masked: hit?.detection.maskedPreview ?? null, found: !!hit, tokens: hit?.tokens.length ?? 0, complete: hit?.complete ?? false, overcover: hit ? Number(hit.overcover.toFixed(2)) : null };
    });
    out.falsePositives = (expected.notSensitive ?? []).filter((v) => ds.some((d) => digits(text.slice(d.detection.start, d.detection.end)) === digits(v))).length;
  }
  return out;
}

const [imagePath, expectedPath] = process.argv.slice(2);
if (!imagePath) {
  console.error('사용: node --experimental-strip-types scripts/ocr-spike.ts <사진.jpg> [기대값.json]');
  process.exit(1);
}
const buf = fs.readFileSync(imagePath);
const { width, height, format } = imageSize(buf);
const expected: Expected | null = expectedPath ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : null;
const results: Record<string, unknown>[] = [];
if (process.env.CLOVA_OCR_URL && process.env.CLOVA_OCR_SECRET) {
  const t = Date.now();
  try {
    results.push(report('CLOVA OCR General', fromClova(await clova(buf, format), width, height), Date.now() - t, expected));
  } catch (e) {
    results.push({ provider: 'CLOVA OCR General', error: e instanceof Error ? e.message : 'error' });
  }
}
if (process.env.GOOGLE_VISION_API_KEY) {
  const t = Date.now();
  try {
    results.push(report('Google Vision', fromGoogleVision(await vision(buf), width, height), Date.now() - t, expected));
  } catch (e) {
    results.push({ provider: 'Google Vision', error: e instanceof Error ? e.message : 'error' });
  }
}
if (!results.length) console.error('키가 없어요: CLOVA_OCR_URL·CLOVA_OCR_SECRET 또는 GOOGLE_VISION_API_KEY');
console.log(JSON.stringify({ image: { width, height, format, bytes: buf.length }, results }, null, 2));
