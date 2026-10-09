// PACTO 계약서 뷰어 (WebView 안에서 실행) — scripts/vendor-viewer.mjs가 pdf.js와 함께 한 파일로 묶는다.
// - 첫 화면: 페이지 폭을 화면 폭에 맞춤 (자르지 않고 축소), 원본 비율·/Rotate 그대로, 여러 쪽은 세로로 이어서
// - 확대: WebView 기본 확대(두 손가락) + 확대가 끝나면 보이는 쪽만 그 배율로 다시 그려 선명하게
// - 메모리: 화면 근처 쪽만 그리고, 멀어진 쪽은 캔버스를 비운다 (큰 스캔 PDF)
// - 네트워크: 문서 Signed URL 한 곳만 (CSP connect-src). CMap·wasm·글꼴은 내장 데이터 — 외부 요청 없음
// - 로그: 남기지 않는다 (URL·내용 없음). 앱으로는 상태 코드·쪽수만 보낸다
import * as pdfjs from 'pdfjs-legacy';
import { KOREAN_CMAPS } from '../../supabase/functions/_shared/vendor/korean-cmaps.js';
import { WORKER_SOURCE, WASM_FILES } from 'pacto-viewer-embedded';

const cfg = window.__PACTO_VIEWER__ || {};
const post = (m) => {
  try {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));
  } catch (_) {
    /* 앱이 없으면 무시 */
  }
};
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** 진단 단계 신호 (단계 이름만 — 주소·내용 없음) */
const step = (name, code) => post({ type: 'step', step: name, ...(code ? { code } : {}) });
const root = document.getElementById('pages');

class EmbeddedCMaps {
  constructor() {}
  async fetch({ name }) {
    const s = KOREAN_CMAPS[name];
    if (!s) throw new Error('cmap_unavailable');
    return { cMapData: b64(s), isCompressed: true };
  }
}
class EmbeddedWasm {
  constructor() {}
  async fetch({ filename }) {
    const s = WASM_FILES[filename];
    if (!s) throw new Error('wasm_unavailable');
    return b64(s);
  }
}
class NoFontData {
  constructor() {}
  async fetch() {
    throw new Error('font_unavailable');
  }
}

function fail(code) {
  document.body.classList.add('error');
  post({ type: 'error', code });
}

// ── PDF ──
const MAX_CANVAS_PIXELS = 12_000_000; // 한 쪽 캔버스 최대 화소 (메모리)
const MAX_ZOOM_QUALITY = 4;
let doc = null;
const slots = []; // { page, base, el, canvas, rendered, task, wanted }
let zoomQuality = 1;
let firstRendered = false;

function outputScale() {
  const dpr = window.devicePixelRatio || 1;
  return dpr * zoomQuality;
}

async function render(slot) {
  if (!slot.wanted) return;
  const scale = outputScale();
  if (slot.rendered === scale || slot.task) return;
  const cssWidth = slot.el.clientWidth;
  if (!cssWidth) return;
  let s = (cssWidth / slot.base.width) * scale;
  const px = slot.base.width * s * slot.base.height * s;
  if (px > MAX_CANVAS_PIXELS) s *= Math.sqrt(MAX_CANVAS_PIXELS / px);
  const viewport = slot.page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const first = !firstRendered;
  if (first) step('first_page_render_started');
  slot.task = slot.page.render({ canvasContext: ctx, viewport });
  try {
    await slot.task.promise;
  } catch (_) {
    slot.task = null;
    if (first) step('error', 'render');
    return;
  }
  slot.task = null;
  if (first) {
    firstRendered = true;
    step('first_page_rendered');
  }
  if (!slot.wanted) return release(slot, canvas);
  if (slot.canvas) release(slot, slot.canvas);
  slot.el.appendChild(canvas);
  slot.canvas = canvas;
  slot.rendered = scale;
}

function release(slot, canvas) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
  if (canvas === slot.canvas) {
    slot.canvas = null;
    slot.rendered = 0;
  }
}

// 한 번에 한 쪽씩 그린다 (메모리·CPU 급증 방지)
let queue = Promise.resolve();
const schedule = (slot) => {
  queue = queue.then(() => render(slot)).catch(() => undefined);
};

async function showPdf() {
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  } catch (_) {
    return fail('worker');
  }
  step('pdfjs_loaded');
  // 진단 3단계: pdf.js 초기화까지만
  if (cfg.kind === 'init') return post({ type: 'loaded', kind: 'init', pages: 0, fit: true });
  let data;
  if (cfg.data) {
    // 진단 4단계: 앱에 포함된 작은 테스트 PDF (네트워크 없음)
    step('pdf_fetch_started', 'embedded');
    data = b64(cfg.data);
  } else {
    if (typeof cfg.url !== 'string' || !/^https:\/\//.test(cfg.url)) return fail('url_invalid');
    step('pdf_fetch_started');
    try {
      const res = await fetch(cfg.url, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!res.ok) return fail('download_' + (res.status >= 500 ? 'server' : res.status === 400 || res.status === 404 ? 'missing' : 'denied'));
      data = new Uint8Array(await res.arrayBuffer());
    } catch (_) {
      return fail('download_network');
    }
  }
  try {
    doc = await pdfjs.getDocument({
      data,
      CMapReaderFactory: EmbeddedCMaps,
      cMapPacked: true,
      WasmFactory: EmbeddedWasm,
      StandardFontDataFactory: NoFontData,
      useWorkerFetch: false,
      useSystemFonts: true,
      isEvalSupported: false,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    return fail(e && e.name === 'PasswordException' ? 'pdf_password' : 'pdf_open');
  }
  data = null;
  step('pdf_loaded');

  // 쪽 크기·회전(/Rotate)만 먼저 읽어 자리를 잡는다 — 그림은 화면 근처에 올 때 그린다
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 }); // 회전 반영된 크기
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i);
    el.style.aspectRatio = `${base.width} / ${base.height}`;
    root.appendChild(el);
    slots.push({ page, base, el, canvas: null, rendered: 0, task: null, wanted: false });
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const slot = slots[Number(e.target.dataset.page) - 1];
        slot.wanted = e.isIntersecting;
        if (slot.wanted) schedule(slot);
        else if (slot.canvas && !slot.task) release(slot, slot.canvas);
      }
    },
    { rootMargin: '150% 0px 150% 0px' },
  );
  slots.forEach((s) => io.observe(s.el));

  // 확대가 끝나면 보이는 쪽만 그 배율로 다시 (흐려지지 않게)
  let t = null;
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = Math.min(MAX_ZOOM_QUALITY, Math.max(1, Math.round(vv.scale * 2) / 2));
        if (q === zoomQuality) return;
        zoomQuality = q;
        slots.filter((s) => s.wanted).forEach(schedule);
      }, 250);
    });
  }

  const target = Number(cfg.page) || 0;
  if (target > 1 && target <= slots.length) slots[target - 1].el.scrollIntoView();
  const first = slots[0].el.getBoundingClientRect();
  post({ type: 'loaded', kind: 'pdf', pages: doc.numPages, fit: first.width <= window.innerWidth + 1 });
}

window.addEventListener('error', () => fail('script'));
window.addEventListener('unhandledrejection', () => fail('script_async'));
// 사진은 별도 HTML(buildImageHtml)로 연다 — 이 스크립트(pdf.js)는 PDF 전용
showPdf().catch(() => fail('unknown'));
