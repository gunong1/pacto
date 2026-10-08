/**
 * 통합 테스트용 가짜 CLOVA OCR 서버 (로컬 Edge Function → http://host.docker.internal:54399/ocr, supabase/functions/.env).
 * 받은 이미지를 실제로 해석해, fixture 응답의 글자 상자가 검게 덮였으면 그 글자는 읽지 못한 것으로 돌려준다 (재-OCR 검증 재현).
 * fixture: src/__fixtures__/photo/*.clova.json (가짜 값). 모르는 이미지는 글자 없음.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require('jpeg-js') as { decode(b: Uint8Array, o: object): { width: number; height: number; data: Uint8Array } };

const FIX = path.resolve(__dirname, '../__fixtures__/photo');
export const FAKE_CLOVA_PORT = 54399;
export const FAKE_CLOVA_SECRET = 'local-test-secret';

type Field = { inferText: string; boundingPoly: { vertices: { x: number; y: number }[] } };

/** 이미지 가로세로 비율로 fixture를 고른다 (보호본은 크기가 줄어 있어도 비율이 같다) */
function fixtureFor(w: number, h: number): { res: { images: { fields: Field[] }[] }; base: { width: number; height: number } } | null {
  const ratio = h / w;
  if (Math.abs(ratio - 1700 / 2400) < 0.01) return { res: JSON.parse(fs.readFileSync(path.join(FIX, 'lease.clova.json'), 'utf8')), base: { width: 2400, height: 1700 } };
  if (Math.abs(ratio - 3391 / 2400) < 0.01) return { res: JSON.parse(fs.readFileSync(path.join(FIX, 'lease-a4.clova.json'), 'utf8')), base: { width: 2400, height: 3391 } };
  if (Math.abs(ratio - 800 / 2400) < 0.01) return { res: JSON.parse(fs.readFileSync(path.join(FIX, 'plain.clova.json'), 'utf8')), base: { width: 2400, height: 800 } };
  return null;
}

export interface FakeClova {
  calls: number;
  /** 다음 요청들에 줄 HTTP 상태 (예: 503 → 서버 오류 재현) */
  failWith: number | null;
  /** 응답을 늦춘다 (ms) */
  delayMs: number;
  close(): Promise<void>;
}

export function startFakeClova(): Promise<FakeClova> {
  const state = { calls: 0, failWith: null as number | null, delayMs: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      state.calls++;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (req.headers['x-ocr-secret'] !== FAKE_CLOVA_SECRET) return void res.writeHead(401).end('{}');
      if (state.failWith) return void res.writeHead(state.failWith).end('{}');
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const bytes = Buffer.from(body.images[0].data, 'base64');
      let img: { width: number; height: number; data: Uint8Array };
      try {
        img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false });
      } catch {
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ images: [{ inferResult: 'FAILURE', fields: [] }] }));
      }
      const fx = fixtureFor(img.width, img.height);
      const fields = (fx?.res.images[0].fields ?? []).filter((f) => {
        const sx = img.width / fx!.base.width;
        const sy = img.height / fx!.base.height;
        for (const v of f.boundingPoly.vertices) {
          v.x = Math.round(v.x * sx);
          v.y = Math.round(v.y * sy);
        }
        const [a, , c] = f.boundingPoly.vertices;
        let dark = 0, n = 0;
        for (let y = a.y; y < c.y; y += 2) for (let x = a.x; x < c.x; x += 2) {
          const i = (y * img.width + x) * 3;
          n++;
          if (img.data[i] < 40 && img.data[i + 1] < 40 && img.data[i + 2] < 40) dark++;
        }
        return n === 0 || dark / n < 0.6;
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: 'V2', images: [{ inferResult: 'SUCCESS', fields }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(FAKE_CLOVA_PORT, '0.0.0.0', () => {
      resolve(Object.assign(state, { close: () => new Promise<void>((r) => server.close(() => r())) }));
    });
  });
}
