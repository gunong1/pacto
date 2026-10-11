/**
 * E2E용 가짜 CLOVA OCR 서버 (로컬 Edge Function → http://host.docker.internal:54399/ocr, supabase/functions/.env).
 * 어떤 사진이든 민감정보 없는 가짜 글자(src/__fixtures__/photo/plain.clova.json)를 사진 크기에 맞춰 돌려준다 → 보호 결과 no_sensitive_data.
 * 2026-10부터 민감정보 보호가 끝나지 않은 사진은 자동 분석을 하지 않으므로(fail-closed), 사진 등록 E2E는 이 서버와 함께 돈다.
 * failWith를 정하면 그 상태 코드로 실패 → 보호 실패 → 분석 차단 화면 확인용.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const jpeg = require('jpeg-js');

const PORT = 54399;
const SECRET = 'local-test-secret'; // 로컬 테스트 전용 값 (통합 테스트 fakeClova.ts와 같음)
const PLAIN = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/__fixtures__/photo/plain.clova.json'), 'utf8'));
const BASE = { width: 2400, height: 800 };

module.exports = function startFakeOcr() {
  const state = { calls: 0, failWith: null };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.calls++;
      if (req.headers['x-ocr-secret'] !== SECRET) return void res.writeHead(401).end('{}');
      if (state.failWith) return void res.writeHead(state.failWith).end('{}');
      let img;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        img = jpeg.decode(Buffer.from(body.images[0].data, 'base64'), { useTArray: true, formatAsRGBA: false });
      } catch {
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ images: [{ inferResult: 'FAILURE', fields: [] }] }));
      }
      const sx = img.width / BASE.width;
      const sy = img.height / BASE.height;
      const fields = PLAIN.images[0].fields.map((f) => ({ ...f, boundingPoly: { vertices: f.boundingPoly.vertices.map((v) => ({ x: Math.round(v.x * sx), y: Math.round(v.y * sy) })) } }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: 'V2', images: [{ inferResult: 'SUCCESS', fields }] }));
    });
  });
  return new Promise((resolve) => server.listen(PORT, '0.0.0.0', () => resolve(Object.assign(state, { close: () => new Promise((r) => server.close(() => r())) }))));
};
