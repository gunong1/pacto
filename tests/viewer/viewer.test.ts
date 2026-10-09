// @ts-nocheck — Playwright(개발 도구) 객체를 다루는 브라우저 테스트. 타입 검사 대신 실행 결과로 확인한다
/**
 * 앱 내 계약서 뷰어 (WebView + 앱에 포함된 pdf.js) — Chromium(Android WebView와 같은 엔진 계열)에서 휴대폰 화면으로 확인
 * 앱과 같은 HTML(buildViewerHtml)을 같은 가상 주소(https://viewer.pacto.invalid/)로 열고, 문서는 Signed URL처럼 다른 출처에서 받는다.
 * 세로·가로·여러 쪽·스캔·/Rotate·보호본·원본·JPG·PNG · 큰 스캔(20쪽) 메모리 · 두 손가락 확대 · 외부 요청 차단
 * 실행: npm run test:viewer   (모든 값은 가짜)
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';

import { buildViewerHtml, isAllowedViewerNavigation, VIEWER_BASE_URL } from '../../src/features/viewer/viewerHtml.ts';
import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { PDFDocument, PDFName } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { employmentContractPdf } from '../protection/fixtures.ts';
import { readFix } from '../protection/scanFixtures.ts';

const require = createRequire(import.meta.url);
// playwright는 개발 도구로 설치된 것을 쓴다 (앱 의존성 아님) — 타입은 필요한 만큼만
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pw = any;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright') as Pw;

const DOCS = 'https://docs.pacto.test/';
const PHONE = { width: 390, height: 844 };
const files = new Map<string, { body: Buffer; type: string }>();

/** 테두리 + 왼쪽 위 검은 막대 (쪽 번호만큼) — 글꼴 없이 방향·내용 확인용 */
async function textPage(doc: PDFDocument, size: [number, number], n: number) {
  const p = doc.addPage(size);
  const black = { type: 'RGB', red: 0, green: 0, blue: 0 } as never;
  p.drawRectangle({ x: 10, y: 10, width: size[0] - 20, height: size[1] - 20, borderWidth: 4, borderColor: black });
  for (let k = 0; k < n; k++) p.drawRectangle({ x: 30 + k * 30, y: size[1] - 80, width: 20, height: 50, color: black });
  // 오른쪽 아래 표시 (회전·잘림 확인용)
  p.drawRectangle({ x: size[0] - 70, y: 25, width: 40, height: 40, color: black });
  return p;
}
async function pdfOf(pages: { size: [number, number]; rotate?: number }[]) {
  const doc = await PDFDocument.create();
  for (const [i, s] of pages.entries()) {
    const p = await textPage(doc, s.size, i + 1);
    if (s.rotate) p.node.set(PDFName.of('Rotate'), doc.context.obj(s.rotate));
  }
  return Buffer.from(await doc.save());
}
async function scanPdf(n: number) {
  const doc = await PDFDocument.create();
  const jpg = readFix('lease-a4.jpg');
  for (let i = 0; i < n; i++) {
    const img = await doc.embedJpg(jpg);
    doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}
/** 간단한 RGB PNG (가로 1200 × 세로 1600, 테두리) */
function png(w: number, h: number) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 12 || y < 12 || x >= w - 12 || y >= h - 12;
      raw.fill(edge ? 30 : 245, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let browser: Pw;
before(async () => {
  const original = Buffer.from(await employmentContractPdf());
  const prot = await protectPdf(new Uint8Array(original));
  assert.equal(prot.status, 'protected');
  files.set('portrait.pdf', { body: await pdfOf([{ size: [595, 842] }]), type: 'application/pdf' });
  files.set('landscape.pdf', { body: await pdfOf([{ size: [842, 595] }]), type: 'application/pdf' });
  files.set('multi.pdf', { body: await pdfOf([{ size: [595, 842] }, { size: [595, 842] }, { size: [842, 595] }, { size: [595, 842] }, { size: [595, 842] }]), type: 'application/pdf' });
  files.set('rotate.pdf', { body: await pdfOf([{ size: [842, 595], rotate: 90 }, { size: [595, 842], rotate: 180 }]), type: 'application/pdf' });
  files.set('scan.pdf', { body: await scanPdf(1), type: 'application/pdf' });
  files.set('scan20.pdf', { body: await scanPdf(20), type: 'application/pdf' });
  files.set('original.pdf', { body: original, type: 'application/pdf' });
  files.set('protected.pdf', { body: Buffer.from(prot.protectedPdf!), type: 'application/pdf' });
  files.set('photo.jpg', { body: Buffer.from(readFix('lease.jpg')), type: 'image/jpeg' });
  files.set('photo.png', { body: png(1200, 1600), type: 'image/png' });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

interface Opened {
  page: Pw;
  msg: { type: string; pages?: number; fit?: boolean; code?: string };
  requests: string[];
  consoleText: string;
  close: () => Promise<void>;
}

/** 앱과 같은 방식으로 뷰어를 연다 (가상 주소 + 문서는 다른 출처, CORS 허용) */
async function open(file: string, kind: 'pdf' | 'image' = 'pdf', pageNo: number | null = null): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const requests: string[] = [];
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  page.on('request', (r) => requests.push(r.url()));
  const url = `${DOCS}object/sign/${file}?token=secret-token`;
  await page.route(`${VIEWER_BASE_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: buildViewerHtml({ url, kind, page: pageNo }) }));
  await page.route(`${DOCS}**`, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop()!;
    const f = files.get(name);
    return f ? r.fulfill({ status: 200, contentType: f.type, body: f.body, headers: { 'access-control-allow-origin': '*' } }) : r.fulfill({ status: 404 });
  });
  await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, body: 'leak' }));
  await page.addInitScript(() => {
    (window as unknown as { __msgs: string[] }).__msgs = [];
    (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = { postMessage: (m: string) => (window as unknown as { __msgs: string[] }).__msgs.push(m) };
  });
  await page.goto(VIEWER_BASE_URL);
  await page.waitForFunction(() => (window as unknown as { __msgs: string[] }).__msgs.length > 0, null, { timeout: 30000 });
  const msg = JSON.parse((await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs[0])) as string);
  return { page, msg, requests, consoleText: consoleLines.join('\n'), close: () => ctx.close() };
}

/** 첫 화면 상태: 페이지 상자 위치·크기, 가로 넘침, 첫 쪽 캔버스가 그려졌는지 */
async function firstScreen(page: Pw) {
  await page.waitForFunction(() => document.querySelector('.page canvas, .image') != null, null, { timeout: 30000 });
  return page.evaluate(() => {
    const el = document.querySelector('.page, .image')!;
    const r = el.getBoundingClientRect();
    const c = document.querySelector('.page canvas') as HTMLCanvasElement | null;
    let ink = 0;
    if (c) {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
      for (let i = 0; i < d.length; i += 40) if (d[i] < 128) ink++;
    }
    return {
      left: r.left, width: r.width, height: r.height, innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth, pages: document.querySelectorAll('.page').length,
      canvasWidth: c?.width ?? 0, ink,
    };
  });
}

const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;

describe('첫 화면: 페이지 폭을 화면 폭에 맞춤 (좌우 잘림 없음) · 비율 유지', () => {
  const CASES: [string, string, 'pdf' | 'image', number][] = [
    ['세로 PDF (A4)', 'portrait.pdf', 'pdf', 842 / 595],
    ['가로 PDF', 'landscape.pdf', 'pdf', 595 / 842],
    ['스캔 PDF', 'scan.pdf', 'pdf', 842 / 595],
    ['/Rotate 90 (가로 MediaBox → 세로로 보임)', 'rotate.pdf', 'pdf', 842 / 595],
    ['보호본 PDF', 'protected.pdf', 'pdf', 842 / 595],
    ['원본 PDF', 'original.pdf', 'pdf', 842 / 595],
    ['사진 JPG', 'photo.jpg', 'image', 1700 / 2400],
    ['사진 PNG', 'photo.png', 'image', 1600 / 1200],
  ];
  for (const [name, file, kind, ratio] of CASES) {
    test(name, async () => {
      const o = await open(file, kind);
      try {
        assert.equal(o.msg.type, 'loaded', JSON.stringify(o.msg));
        assert.equal(o.msg.fit, true);
        const s = await firstScreen(o.page);
        if (process.env.VIEWER_SHOTS) await o.page.screenshot({ path: `${process.env.VIEWER_SHOTS}/${file}.png` });
        assert.ok(near(s.left, 0) && near(s.width, s.innerWidth), `폭 맞춤 ${JSON.stringify(s)}`);
        assert.ok(s.scrollWidth <= s.innerWidth, `가로 넘침 없음 ${JSON.stringify(s)}`);
        assert.ok(Math.abs(s.height / s.width - ratio) < 0.01, `비율 ${s.height / s.width} vs ${ratio}`);
        if (kind === 'pdf') {
          assert.ok(s.canvasWidth >= s.innerWidth * 2, `선명도(기기 화소 배율) ${s.canvasWidth}`);
          assert.ok(s.ink > 0, '첫 쪽이 실제로 그려짐');
        }
        assert.ok(!o.consoleText.includes('secret-token') && !o.consoleText.includes('docs.pacto.test'), '콘솔에 문서 주소 없음');
      } finally {
        await o.close();
      }
    });
  }
});

describe('여러 쪽 · /Rotate · 쪽 이동', () => {
  test('여러 쪽 PDF: 세로로 이어서 5쪽, 쪽마다 폭 맞춤(가로 쪽은 가로 비율)', async () => {
    const o = await open('multi.pdf');
    try {
      assert.equal(o.msg.pages, 5);
      const boxes = await o.page.evaluate(() => [...document.querySelectorAll('.page')].map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, top: e.getBoundingClientRect().top })));
      assert.equal(boxes.length, 5);
      for (const b of boxes) assert.ok(near(b.w, PHONE.width));
      assert.ok(Math.abs(boxes[2].h / boxes[2].w - 595 / 842) < 0.01, '3쪽은 가로');
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top > boxes[i - 1].top, '세로 순서');
    } finally {
      await o.close();
    }
  });

  test('/Rotate 180 쪽도 비율 그대로', async () => {
    const o = await open('rotate.pdf');
    try {
      const r = await o.page.evaluate(() => { const b = document.querySelectorAll('.page')[1].getBoundingClientRect(); return b.height / b.width; });
      assert.ok(Math.abs(r - 842 / 595) < 0.01, String(r));
    } finally {
      await o.close();
    }
  });

  test('근거 위치: 원하는 쪽(page=3)으로 이동해서 열기', async () => {
    const o = await open('multi.pdf', 'pdf', 3);
    try {
      const top = await o.page.evaluate(() => document.querySelectorAll('.page')[2].getBoundingClientRect().top);
      assert.ok(Math.abs(top) < 5, `3쪽이 화면 맨 위 ${top}`);
    } finally {
      await o.close();
    }
  });
});

describe('두 손가락 확대 · 이동', () => {
  test('확대(2.5배) → 오른쪽으로 이동 가능 · 보이는 쪽을 더 높은 해상도로 다시 그림', async () => {
    const o = await open('portrait.pdf');
    try {
      const before = await firstScreen(o.page);
      const cdp = await o.page.context().newCDPSession(o.page);
      await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 300, scaleFactor: 2.5, gestureSourceType: 'mouse' }); // 헤드리스에서는 터치 핀치 합성이 안 돼 같은 확대 경로(핀치 줌)를 마우스 원천으로
      await o.page.waitForFunction(() => (window.visualViewport?.scale ?? 1) > 2, null, { timeout: 5000 });
      await o.page.waitForFunction((w) => ((document.querySelector('.page canvas') as HTMLCanvasElement)?.width ?? 0) > w * 1.5, before.canvasWidth, { timeout: 10000 });
      const after = await o.page.evaluate(() => ({ scale: window.visualViewport!.scale, canvasWidth: (document.querySelector('.page canvas') as HTMLCanvasElement).width }));
      assert.ok(after.scale > 2, JSON.stringify(after));
      // 확대 상태에서 오른쪽·아래로 이동 (visual viewport 이동)
      await o.page.mouse.move(150, 300);
      await o.page.mouse.wheel(300, 300);
      await o.page.waitForTimeout(300);
      const moved = await o.page.evaluate(() => ({ x: window.visualViewport!.offsetLeft + window.scrollX, y: window.visualViewport!.offsetTop + window.scrollY }));
      assert.ok(moved.x > 50 && moved.y > 50, `이동 ${JSON.stringify(moved)}`);
    } finally {
      await o.close();
    }
  });
});

describe('큰 스캔 PDF (20쪽, 약 10MB) — 화면 근처 쪽만 그림', () => {
  test('끝까지 넘겨도 동시에 살아 있는 캔버스는 몇 장뿐 · 마지막 쪽까지 그려짐', async () => {
    const o = await open('scan20.pdf');
    try {
      assert.equal(o.msg.pages, 20);
      const t0 = Date.now();
      await firstScreen(o.page);
      const firstMs = Date.now() - t0;
      let maxCanvases = 0;
      let maxPixels = 0;
      for (let y = 0; y < 40; y++) {
        await o.page.mouse.wheel(0, 900);
        await o.page.waitForTimeout(120);
        const s = await o.page.evaluate(() => {
          const cs = [...document.querySelectorAll('.page canvas')] as HTMLCanvasElement[];
          return { n: cs.length, px: cs.reduce((a, c) => a + c.width * c.height, 0) };
        });
        maxCanvases = Math.max(maxCanvases, s.n);
        maxPixels = Math.max(maxPixels, s.px);
      }
      await o.page.waitForFunction(() => document.querySelectorAll('.page')[19].querySelector('canvas') != null, null, { timeout: 20000 });
      const heap = await o.page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
      console.log(`viewer-report scan20: first page ${firstMs}ms, max canvases ${maxCanvases}, max canvas pixels ${(maxPixels / 1e6).toFixed(1)}M (~${Math.round((maxPixels * 4) / 1e6)}MB), JS heap ${Math.round(heap / 1e6)}MB`);
      assert.ok(maxCanvases <= 6, `동시에 그려 둔 쪽 ${maxCanvases}`);
    } finally {
      await o.close();
    }
  });
});

describe('보안', () => {
  test('문서 주소 외 외부 요청은 CSP로 막힘 · 요청은 뷰어 주소와 문서 주소뿐', async () => {
    const o = await open('portrait.pdf');
    try {
      const leaked = await o.page.evaluate(async () => {
        try {
          await fetch('https://example.com/collect?x=1');
          return true;
        } catch {
          return false;
        }
      });
      assert.equal(leaked, false);
      const hosts = new Set(o.requests.filter((u) => u.startsWith('http')).map((u) => new URL(u).origin));
      assert.deepEqual([...hosts].sort(), ['https://docs.pacto.test', 'https://viewer.pacto.invalid']);
    } finally {
      await o.close();
    }
  });

  test('앱 WebView 이동 허용 규칙: 뷰어 주소만', () => {
    assert.equal(isAllowedViewerNavigation(VIEWER_BASE_URL), true);
    assert.equal(isAllowedViewerNavigation('https://evil.example/'), false);
    assert.equal(isAllowedViewerNavigation('https://docs.pacto.test/object/sign/x.pdf'), false);
    assert.equal(isAllowedViewerNavigation('intent://x'), false);
  });

  test('주소 문자열이 HTML을 깨뜨리지 않음 (</script> 포함 주소)', () => {
    const html = buildViewerHtml({ url: 'https://docs.pacto.test/a?b=</script><script>alert(1)</script>', kind: 'pdf' });
    assert.ok(!html.includes('</script><script>alert(1)'));
  });

  test('읽을 수 없는 문서 → 오류 코드만 알림 (주소·내용 없음)', async () => {
    files.set('broken.pdf', { body: Buffer.from('not a pdf'), type: 'application/pdf' });
    const o = await open('broken.pdf');
    try {
      assert.deepEqual(o.msg, { type: 'error', code: 'pdf_open' });
    } finally {
      await o.close();
    }
  });
});
