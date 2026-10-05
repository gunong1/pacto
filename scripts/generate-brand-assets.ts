/**
 * 브랜드 심볼로 앱 아이콘 / 스플래시 / 파비콘 PNG 생성.
 * 실행: PLAYWRIGHT_MODULE=<playwright 경로> node --experimental-strip-types scripts/generate-brand-assets.ts
 * (playwright는 프로젝트 의존성이 아니라 개발 도구로 사용)
 */
import { createRequire } from 'node:module';
import path from 'node:path';

import { BRAND_COLORS, SYMBOL, SYMBOL_COLORS, symbolSvgElements, type SymbolColors } from '../src/components/brand/geometry.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const OUT = path.resolve(import.meta.dirname, '../assets/images');

interface Asset {
  file: string;
  size: number;
  /** 심볼 높이 / 캔버스 크기 */
  scale: number;
  background: string | null;
  colors: SymbolColors;
}

const ASSETS: Asset[] = [
  // iOS/기본 아이콘: 꽉 찬 네이비 (iOS가 모서리 마스크 적용)
  { file: 'icon.png', size: 1024, scale: 0.6, background: BRAND_COLORS.navyDeep, colors: SYMBOL_COLORS.inverse },
  // Android adaptive: 배경 레이어 + 전경(안전영역 66% 안쪽)
  { file: 'android-icon-background.png', size: 512, scale: 0, background: BRAND_COLORS.navyDeep, colors: SYMBOL_COLORS.inverse },
  { file: 'android-icon-foreground.png', size: 512, scale: 0.4, background: null, colors: { ...SYMBOL_COLORS.inverse, gap: 'transparent' } },
  { file: 'android-icon-monochrome.png', size: 432, scale: 0.4, background: null, colors: { front: '#FFFFFF', middle: '#FFFFFF', back: '#FFFFFF', gap: 'transparent' } },
  // 스플래시: 흰 배경 위 컬러 심볼
  { file: 'splash-icon.png', size: 400, scale: 0.9, background: null, colors: { ...SYMBOL_COLORS.color, gap: 'transparent' } },
  { file: 'favicon.png', size: 48, scale: 0.6, background: BRAND_COLORS.navyDeep, colors: SYMBOL_COLORS.inverse },
];

function html(a: Asset): string {
  const h = a.size * a.scale;
  const svg = a.scale > 0 ? `<svg viewBox="${SYMBOL.viewBox}" height="${h}">${symbolSvgElements(a.colors)}</svg>` : '';
  return `<html><body style="margin:0;width:${a.size}px;height:${a.size}px;display:flex;align-items:center;justify-content:center;background:${a.background ?? 'transparent'}">${svg}</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of ASSETS) {
  await page.setViewportSize({ width: a.size, height: a.size });
  await page.setContent(html(a));
  await page.screenshot({ path: path.join(OUT, a.file), omitBackground: a.background == null });
  console.log('✔', a.file, `${a.size}px`);
}
await browser.close();
