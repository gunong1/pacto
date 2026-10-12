/**
 * 지급자·수령자(payer/payee) · 돈의 성격 · 서버 방향 규칙 — 모델 평가 (실제 AI 호출).
 *
 * 사용 (Windows PowerShell, 폴더 C:\Users\김지은\pacto\pacto 에서):
 *   $env:OPENAI_API_KEY = "sk-..."                 # 키는 이 창에서만 (코드·채팅·결과 파일에 남기지 않음)
 *   npx tsx scripts/eval-money-flow.ts --dry-run   # API를 부르지 않고 평가 세트만 확인 (비용 0)
 *   npx tsx scripts/eval-money-flow.ts             # 실제 평가 1회
 *   npx tsx scripts/eval-money-flow.ts --runs 3    # 3번 (흔들림 확인)
 *   npx tsx scripts/eval-money-flow.ts --out money-flow-result.json   # 결과 저장 (계약서 원문·키 없음)
 *   Remove-Item Env:OPENAI_API_KEY                 # 끝나면 키 지우기
 *
 * 운영 경로 재사용: 같은 지시문·JSON 스키마(buildOpenAIRequest) · 같은 모델 · 같은 서버 정리(toAppResult — F1 방향 규칙 포함).
 * 운영 서버 함수·DB를 쓰지 않는다 (Supabase 프로젝트 불필요). 운영은 PDF·사진을 보내고 여기서는 같은 내용의 가짜 텍스트를 보낸다.
 * 평가 세트: scripts/eval/moneyFlowCases.ts (전부 가짜). 채점: scripts/eval/moneyFlowScore.ts
 */
import { buildOpenAIRequest, readOutputText } from '../supabase/functions/_shared/ai/openai';
import { PROMPT_VERSION, toAppResult } from '../supabase/functions/_shared/extraction';
import { MONEY_FLOW_CASES, type MoneyFlowCase } from './eval/moneyFlowCases';
import { scoreCase, summarize, type PaymentScore } from './eval/moneyFlowScore';

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Math.max(1, Number(value('--runs') ?? 1));
const out = value('--out');
const dry = args.includes('--dry-run');
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const today = new Date().toISOString().slice(0, 10);

function requestFor(c: MoneyFlowCase) {
  const req = buildOpenAIRequest(model, [], today);
  const content = req.input[0].content as { type: string; text?: string }[];
  req.input[0].content = [{ type: 'input_text', text: `[파일 1 · 1쪽 — 계약서 본문]\n${c.text}` }, ...content];
  return req;
}

async function analyze(c: MoneyFlowCase) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 환경변수가 없습니다 (PowerShell: $env:OPENAI_API_KEY = "sk-...")');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestFor(c)),
    signal: AbortSignal.timeout(180_000),
  });
  // 응답 본문은 남기지 않는다 (상태 코드만)
  if (!res.ok) throw new Error(`http_${res.status}`);
  return toAppResult(JSON.parse(readOutputText(await res.json())), 'openai');
}

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 1000) / 10}% (${n}/${d})`);
const role = (r: string | null) => r ?? '(없음)';

async function main() {
  console.log(`지급자·수령자 평가 · 지시문 ${PROMPT_VERSION} · 모델 ${model} · ${MONEY_FLOW_CASES.length}건 × ${runs}회${dry ? ' · dry-run (AI 호출 안 함)' : ''}\n`);
  if (dry) {
    for (const c of MONEY_FLOW_CASES) console.log(`- ${c.id}: ${c.name} · 금액 ${c.payments.length}개 (요청 ${JSON.stringify(requestFor(c)).length.toLocaleString()}자)`);
    console.log('\n※ dry-run은 검증이 아닙니다. 실제 평가는 키를 넣고 --dry-run 없이 실행하세요.');
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY가 없어 실제 평가를 하지 않았습니다. PowerShell: $env:OPENAI_API_KEY = "sk-..." 후 다시 실행하세요.');
    process.exit(2);
  }
  const rows: (PaymentScore & { run: number; kind: string })[] = [];
  const errors: { id: string; run: number; error: string }[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const c of MONEY_FLOW_CASES) {
      try {
        const r = await analyze(c);
        for (const s of scoreCase(c, r.classification.kind, r.payments)) rows.push({ ...s, run, kind: r.classification.kind });
        process.stdout.write('.');
      } catch (e) {
        errors.push({ id: c.id, run, error: e instanceof Error ? e.message : 'error' });
        process.stdout.write('!');
      }
    }
  }
  console.log('\n');

  console.log('| 계약 | 금액 | 기대 지급자→수령자 | 실제 지급자→수령자 | 성격(기대/실제) | 방향(기대/실제) | 결과 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const a = r.actual;
    const problems = [
      !r.found && '금액을 찾지 못함',
      r.found && !(r.payerOk && r.payeeOk) && (r.guessed ? '근거 없이 역할 추측' : '역할 다름'),
      r.found && !r.natureOk && '성격 다름',
      r.unsafeDirection && '⚠ 방향을 정하면 안 되는데 정함',
      r.found && !r.directionOk && !r.unsafeDirection && '방향 다름',
    ].filter(Boolean);
    const caseName = `${MONEY_FLOW_CASES.find((c) => c.id === r.caseId)!.name}${runs > 1 ? ` #${r.run}` : ''}${r.kind !== MONEY_FLOW_CASES.find((c) => c.id === r.caseId)!.kind ? ` (분류: ${r.kind})` : ''}`;
    console.log(
      `| ${caseName} | ${r.label} ${r.amount.toLocaleString('ko-KR')}원 | ${role(r.expected.payer)}→${role(r.expected.payee)} | ${a ? `${role(a.payer)}→${role(a.payee)}` : '-'} | ${r.expected.nature}/${a?.nature ?? '-'} | ${r.expected.direction}/${a?.direction ?? '-'} | ${problems.length ? problems.join(', ') : 'PASS'} |`,
    );
  }
  const s = summarize(rows);
  console.log('\n지표');
  console.log(`- 금액 찾음: ${pct(s.found, s.payments)}`);
  console.log(`- 계약서가 밝힌 지급자·수령자 정확도: ${pct(s.explicitRoles.ok, s.explicitRoles.total)}`);
  console.log(`- 근거 없는 금액에서 역할을 비워 둔 비율: ${pct(s.silentRoles.blank, s.silentRoles.total)}`);
  console.log(`- ⚠ 근거 없이 역할을 채운 금액(추측): ${s.guessed}건`);
  console.log(`- 돈의 성격(보증금/일반) 정확도: ${pct(s.nature.ok, s.nature.total)}`);
  console.log(`- 서버 규칙 적용 후 방향 정확도: ${pct(s.direction.ok, s.direction.total)}`);
  console.log(`- ⚠ 방향을 정하면 안 되는데 정한 금액: ${s.unsafeDirection}건 (0이어야 함)`);
  if (errors.length) console.log(`- 호출 오류: ${errors.length}건 (${errors.map((e) => `${e.id}:${e.error}`).join(', ')}) — 오류가 있으면 검증 완료가 아닙니다`);

  if (out) {
    const fs = await import('node:fs');
    fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, model, date: today, runs, summary: s, errors, rows }, null, 2));
    console.log(`\n결과 저장: ${out} (계약서 원문·API 키 없음)`);
  }
}

main().catch((e) => {
  console.error('평가 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
