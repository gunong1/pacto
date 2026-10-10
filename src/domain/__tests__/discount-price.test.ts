/**
 * 할인 전 금액 ≠ 실제 결제액 (정수기 렌탈 샘플 구조 · 모든 값은 가짜)
 * 월 렌탈료 45,900원(할인전) + 전체회차 14,000원 할인 + 1·13·25·38·48·59회차 면제 + 등록비·설치비 면제
 * A 할인전 금액은 결제액으로 채우지 않음 ("할인 적용 금액 확인 필요") · 저장하려면 실제 결제액 입력 필요
 * B 사용자가 입력한 실제 결제액(31,900)으로 저장 → 일정·지출은 기존 로직 (45,900 없음)
 * C 할인액·면제 비용은 결제가 아님 (참고 금액: 할인·면제) / 할인·면제 조건은 계약 체크(할인·면제 조건)로
 * D 표현 변형(할인 전·정상가·프로모션 적용 전·소비자가 / price_basis) · 오탐(고정가·확정가) / E 할인 없는 계약은 그대로
 */
import {
  rentalDiscountOutput,
  rentalOutput,
} from "../../../supabase/functions/_shared/ai/mockFixtures";
import {
  toAppResult,
  WAIVED_CHECK_TITLE,
} from "../../../supabase/functions/_shared/extraction.ts";
import { draftToRecord } from "@/data/draft";
import {
  contractFormSchema,
  draftToForm,
  formToDraft,
} from "@/features/contracts/form";
import {
  DISCOUNT_CHECK_LABEL,
  toReviewModel,
} from "@/features/registration/extraction";

import { scheduleForRange } from "../schedule";
import { monthSpending } from "../spending";

const TODAY = "2026-03-01";
const result = () => toAppResult(rentalDiscountOutput("정수기 렌탈"), "openai");
/** 확인 화면 기본값 (할인전 금액은 비움) */
const reviewForm = () => {
  const m = toReviewModel(result(), ["doc-1"]);
  const v = draftToForm(m.draft);
  for (const i of m.blankAmounts)
    v.payments[i] = { ...v.payments[i], amount: "" };
  return { m, v };
};

describe("A. 할인전 금액은 확정 결제로 자동 저장하지 않는다", () => {
  test("서버: 월 렌탈료 45,900(할인전) → 금액 확인 필요 (모델이 actual로 보내도 원문으로 판단)", () => {
    const r = result();
    expect(r.payments.map((p) => [p.label, p.amount, p.amountCheck])).toEqual([
      ["월 렌탈료", 45900, "discount_unconfirmed"],
    ]);
  });

  test('확인 화면: 금액 칸을 비우고 "할인 적용 금액 확인 필요" 안내', () => {
    const { m, v } = reviewForm();
    expect(m.blankAmounts).toEqual([0]);
    expect(v.payments[0].amount).toBe("");
    expect(m.flagged.has("payments.0.amount")).toBe(true);
    expect(m.notes["payments.0.amount"]).toContain(DISCOUNT_CHECK_LABEL);
    expect(m.notes["payments.0.amount"]).toContain("45,900원");
  });

  test("실제 결제액을 입력하지 않으면 저장할 수 없음", () => {
    const { v } = reviewForm();
    const parsed = contractFormSchema.safeParse(v);
    expect(parsed.success).toBe(false);
    expect(
      parsed.error!.issues.some(
        (i) => i.path.join(".") === "payments.0.amount",
      ),
    ).toBe(true);
  });
});

describe("B. 사용자가 입력한 실제 결제액으로 저장", () => {
  test("31,900 입력 → amount 31,900 · 매월 15일 일정·지출은 31,900 (45,900·14,000 없음)", () => {
    const { v } = reviewForm();
    v.payments[0].amount = "31,900";
    const draft = formToDraft(contractFormSchema.parse(v));
    expect(
      draft.payments.map((p) => [p.label, p.amount, p.frequency, p.dayOfMonth]),
    ).toEqual([["월 렌탈료", 31900, "monthly", 15]]);
    const rec = draftToRecord(draft, "c1", TODAY);
    const items = scheduleForRange(
      [rec],
      { start: "2026-04-01", end: "2026-04-30" },
      TODAY,
    ).filter((i) => i.type === "payment");
    expect(items.map((i) => [i.date, i.amount])).toEqual([
      ["2026-04-15", 31900],
    ]);
    expect(monthSpending([rec], { year: 2026, month: 4 }).total).toBe(31900);
    expect(JSON.stringify(items)).not.toMatch(/45900|14000/);
  });
});

describe("C. 할인액·면제 비용·할인 조건", () => {
  test("할인액(14,000)·등록비·설치비 면제는 결제가 아니라 참고 금액(할인·면제)", () => {
    const r = result();
    expect(r.references).toEqual([
      { label: "E규정 할인", amount: 14000, role: "discount" },
      { label: "등록비", amount: 100000, role: "waived" },
      { label: "설치비", amount: 30000, role: "waived" },
    ]);
    const m = toReviewModel(r, ["doc-1"]);
    expect(m.draft.payments.map((p) => p.label)).toEqual(["월 렌탈료"]);
    expect(m.references.map((x) => x.role)).toEqual([
      "discount",
      "waived",
      "waived",
    ]);
  });

  test("회차 면제·전체회차 할인은 계약 체크(할인·면제 조건)로 — 회차별 결제는 만들지 않음 · 면제된 금액도 체크로 보관", () => {
    const r = result();
    const discount = r.checks.filter((c) => c.topic === "discount_terms");
    expect(discount.map((c) => c.title)).toEqual([
      "전체회차 할인",
      "회차 면제 프로모션",
      WAIVED_CHECK_TITLE,
    ]);
    expect(discount[1].evidenceQuote).toContain(
      "1, 13, 25, 38, 48, 59회차 면제",
    );
    expect(discount[2].description).toContain(
      "등록비 100,000원, 설치비 30,000원",
    );
    // 확인 화면 체크에도 그대로 (계약에 저장되는 체크)
    expect(
      toReviewModel(r, ["doc-1"]).checks.filter(
        (c) => c.topic === "discount_terms",
      ),
    ).toHaveLength(3);
  });
});

describe("D. 표현 변형 · 오탐", () => {
  const one = (
    label: string,
    quote: string,
    extra: Record<string, unknown> = {},
  ) => {
    const raw = rentalOutput("렌탈") as { payments: Record<string, unknown>[] };
    raw.payments = [
      { ...raw.payments[0], label, evidence_quote: quote, ...extra },
    ];
    return toAppResult(raw, "openai").payments[0];
  };
  test.each([
    ["월 이용료", "월 이용료 39,000원(할인 전)"],
    ["월 이용료", "정상가 39,000원"],
    ["월 이용료", "프로모션 적용 전 월 39,000원"],
    ["월 이용료", "월 39,000원 (프로모션 전)"],
    ["월 이용료(정가)", "월 39,000원"],
    ["월 이용료", "소비자가격 39,000원"],
  ])('"%s" / "%s" → 확인 필요', (label, quote) => {
    expect(one(label, quote).amountCheck).toBe("discount_unconfirmed");
  });
  test("원문에 표시가 없어도 모델이 before_discount로 판단하면 확인 필요", () => {
    expect(
      one("월 이용료", "월 이용료 39,000원", { price_basis: "before_discount" })
        .amountCheck,
    ).toBe("discount_unconfirmed");
  });
  test.each([
    ["월 렌탈료", "월 렌탈료 29,900원 (고정가)"],
    ["월 렌탈료", "확정가 29,900원"],
    ["월 렌탈료", "월 렌탈료 29,900원 (할인 적용가)"],
  ])('"%s" / "%s" → 실제 결제액 그대로', (label, quote) => {
    expect(one(label, quote).amountCheck ?? null).toBeNull();
  });
});

describe("C-2. 실제 결제를 숨기지 않음", () => {
  const pays = (ps: Record<string, unknown>[]) => {
    const raw = rentalOutput("렌탈") as { payments: Record<string, unknown>[] };
    raw.payments = ps.map((p) => ({ ...raw.payments[0], ...p }));
    return toAppResult(raw, "openai");
  };
  test.each([
    ["할인 적용 월 렌탈료", "할인 적용 월 렌탈료 31,900원"],
    ["할인 후 월 요금", "할인 후 월 요금 31,900원"],
    ["월 이용료", "첫 달 무료, 이후 월 9,900원"],
    ["월 렌탈료", "월 렌탈료 31,900원 (1, 13회차 면제)"],
  ])('"%s" (정기) → 결제 그대로', (label, quote) => {
    const r = pays([{ label, amount: 31900, evidence_quote: quote }]);
    expect(r.payments.map((p) => p.label)).toEqual([label]);
    expect(r.references).toEqual([]);
  });
  test.each([
    ["월 렌탈료 할인"],
    ["프로모션 할인"],
    ["제휴카드 할인액"],
    ["할인혜택"],
  ])('"%s" → 할인액(참고)', (label) => {
    const r = pays([
      { label, amount: 5000, evidence_quote: `${label} 5,000원` },
    ]);
    expect(r.payments).toEqual([]);
    expect(r.references).toEqual([{ label, amount: 5000, role: "discount" }]);
  });
});

describe("E. 할인 없는 계약은 그대로", () => {
  test("일반 렌탈 29,900 → 금액 채움 · 확인 필요 없음 · 설치비는 결제", () => {
    const r = toAppResult(rentalOutput("공기청정기 렌탈"), "openai");
    expect(
      r.payments.map((p) => [p.label, p.amount, p.amountCheck ?? null]),
    ).toEqual([
      ["월 렌탈료", 29900, null],
      ["초기 설치비", 20000, null],
    ]);
    const m = toReviewModel(r, ["doc-1"]);
    expect(m.blankAmounts).toEqual([]);
    expect(draftToForm(m.draft).payments[0].amount).toBe("29,900");
    expect(r.checks.some((c) => c.topic === "discount_terms")).toBe(false);
  });
});
