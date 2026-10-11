/**
 * 계약 종류 분류 — 모델 평가 (실제 AI 호출). 결정론 테스트(jest golden)와 따로 돈다.
 *
 * 사용 (Windows PowerShell):
 *   $env:OPENAI_API_KEY = "sk-..."          # 키는 환경변수로만 (코드·로그·결과 파일에 남기지 않음)
 *   npx tsx scripts/eval-classification.ts               # 기본: 운영과 같은 모델(OPENAI_MODEL 또는 gpt-5.4-mini), 1회
 *   npx tsx scripts/eval-classification.ts --runs 3      # 같은 세트를 3번 (흔들림 확인)
 *   npx tsx scripts/eval-classification.ts --dry-run     # API를 부르지 않고 세트·요청 크기만 확인
 *   npx tsx scripts/eval-classification.ts --out eval-result.json   # 결과 저장 (계약서 원문·키 없음)
 *
 * 운영 경로 재사용: 같은 지시문·JSON 스키마(buildOpenAIRequest) · 같은 모델 · 같은 서버 정리(toAppResult)를 쓴다.
 * 차이: 운영은 PDF·사진 파일을 보내고, 평가는 같은 내용의 가짜 계약서 텍스트를 보낸다 (파일 읽기 정확도는 이 평가 범위 밖).
 * 평가 세트: scripts/eval/classificationCases.ts (전부 가짜 — 실제 계약서·개인정보 금지). 모델·지시문을 바꾸면 같은 세트로 다시 돌린다.
 */
import { buildOpenAIRequest, readOutputText } from '../supabase/functions/_shared/ai/openai';
import { contractKindLabel } from '../supabase/functions/_shared/contractRegistry';
import { PROMPT_VERSION, toAppResult } from '../supabase/functions/_shared/extraction';
import { CASES, type EvalCase } from './eval/classificationCases';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Math.max(1, Number(value('--runs') ?? 1));
const out = value('--out');
const dry = flag('--dry-run');
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const today = new Date().toISOString().slice(0, 10);

interface Row {
  id: string;
  name: string;
  run: number;
  expected: string;
  expectedSubtype: string | null;
  actual: string;
  subtype: string | null;
  confidence: string;
  alternatives: string[];
  pass: boolean;
  subtypePass: boolean | null;
  error?: string;
}

/** 운영과 같은 요청에서 파일 대신 가짜 계약서 텍스트 (마지막 안내 문장은 그대로) */
function requestFor(c: EvalCase) {
  const req = buildOpenAIRequest(model, [], today);
  const content = req.input[0].content as { type: string; text?: string }[];
  req.input[0].content = [{ type: 'input_text', text: `[파일 1 · 1쪽 — 계약서 본문]\n${c.text}` }, ...content];
  return req;
}

async function classify(c: EvalCase) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수가 없습니다');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestFor(c)),
    signal: AbortSignal.timeout(180_000),
  });
  // 응답 본문은 남기지 않는다 (상태 코드만)
  if (!res.ok) throw new Error(`http_${res.status}`);
  const json = JSON.parse(readOutputText(await res.json()));
  return toAppResult(json, 'openai').classification;
}

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 1000) / 10}% (${n}/${d})`);

async function main() {
  console.log(`계약 종류 분류 평가 · 지시문 ${PROMPT_VERSION} · 모델 ${model} · ${CASES.length}건 × ${runs}회${dry ? ' · dry-run' : ''}\n`);
  if (dry) {
    for (const c of CASES) console.log(`- ${c.id}: ${c.name} → ${c.expected.kind}/${c.expected.subtype ?? '-'} (요청 ${JSON.stringify(requestFor(c)).length.toLocaleString()}자)`);
    return;
  }
  const rows: Row[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const c of CASES) {
      const base = { id: c.id, name: c.name, run, expected: c.expected.kind, expectedSubtype: c.expected.subtype };
      try {
        const r = await classify(c);
        const pass = r.kind === c.expected.kind || (c.acceptable ?? []).includes(r.kind);
        rows.push({ ...base, actual: r.kind, subtype: r.subtype, confidence: r.confidence, alternatives: r.alternatives, pass, subtypePass: c.expected.subtype ? r.subtype === c.expected.subtype : null });
        process.stdout.write(pass ? '.' : 'x');
      } catch (e) {
        rows.push({ ...base, actual: '-', subtype: null, confidence: '-', alternatives: [], pass: false, subtypePass: null, error: e instanceof Error ? e.message : 'error' });
        process.stdout.write('!');
      }
    }
  }
  console.log('\n');

  // 결과 표 (원문 없음)
  console.log('| 계약 | 예상 종류 | 실제 종류 | 상세 분류 | 신뢰도 | 다른 후보 | 결과 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const result = r.error ? `오류(${r.error})` : r.pass ? (r.subtypePass === false ? 'PASS (상세 분류 다름)' : 'PASS') : 'FAIL';
    console.log(`| ${r.name}${runs > 1 ? ` #${r.run}` : ''} | ${contractKindLabel(r.expected)} | ${r.actual === '-' ? '-' : contractKindLabel(r.actual)} | ${r.subtype ?? '-'}${r.expectedSubtype && r.subtype !== r.expectedSubtype ? ` (예상 ${r.expectedSubtype})` : ''} | ${r.confidence} | ${r.alternatives.map(contractKindLabel).join(', ') || '-'} | ${result} |`);
  }

  // 지표
  const done = rows.filter((r) => !r.error);
  const wrong = done.filter((r) => !r.pass);
  const highWrong = wrong.filter((r) => r.confidence === 'high');
  const ambiguousIds = new Set(CASES.filter((c) => c.ambiguous).map((c) => c.id));
  const ambiguous = done.filter((r) => ambiguousIds.has(r.id));
  const withSubtype = done.filter((r) => r.subtypePass !== null);
  const caseOf = (id: string) => CASES.find((c) => c.id === id)!;
  const altHasTruth = wrong.filter((r) => r.alternatives.includes(r.expected) || (caseOf(r.id).acceptable ?? []).some((k) => r.alternatives.includes(k)));
  const wrongHeld = wrong.filter((r) => r.confidence !== 'high');
  console.log('\n지표');
  console.log(`- 주 분류 정확도: ${pct(done.length - wrong.length, done.length)}`);
  console.log(`- 상세 분류 정확도: ${pct(withSubtype.filter((r) => r.subtypePass).length, withSubtype.length)}`);
  console.log(`- ⚠ 신뢰도 높음인데 틀림 (가장 위험): ${pct(highWrong.length, done.length)}${highWrong.length ? ` — ${highWrong.map((r) => r.id).join(', ')}` : ''}`);
  console.log(`- 틀린 것 중 신뢰도 보통·낮음으로 보류한 비율: ${pct(wrongHeld.length, wrong.length)}`);
  console.log(`- 애매한 계약을 보통·낮음으로 보류한 비율: ${pct(ambiguous.filter((r) => r.confidence !== 'high').length, ambiguous.length)}`);
  console.log(`- 틀린 것 중 다른 후보에 정답이 있던 비율: ${pct(altHasTruth.length, wrong.length)}`);
  if (rows.some((r) => r.error)) console.log(`- 호출 오류: ${rows.filter((r) => r.error).length}건`);

  if (out) {
    const fs = await import('node:fs');
    fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, model, date: today, runs, rows }, null, 2));
    console.log(`\n결과 저장: ${out} (계약서 원문·API 키 없음)`);
  }
}

main().catch((e) => {
  console.error('평가 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
