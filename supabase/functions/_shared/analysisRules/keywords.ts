/**
 * 단어 규칙 모음 — 서버 정리 규칙이 쓰는 정규식을 한 곳에 모은다.
 * 각 규칙: 이름 · 목적 · 대표 예 (맞는 예 / 아닌 예). 어디에 적용하는지(이름만인지, 근거 문장인지)는 쓰는 규칙 파일이 정한다.
 * 테스트: src/domain/__tests__/analysis-keywords.test.ts
 */

/**
 * CONDITIONAL_COST — 상황이 생겼을 때만 내는 돈의 단서
 * 예) "중도해지 위약금" "연체료" "분실 시 배상" "초과주행료" / 아님) "월 렌탈료" "월세"
 */
export const CONDITIONAL_COST = /양도|명의\s*변경|분실|파손|훼손|손상|연체|지연\s*(?:손해|이자|료|비용)|반납\s*지연|위약|중도\s*해지|중도\s*상환|해지\s*수수료|초과\s*(?:주행|사용|이용)|원상\s*복구|손해\s*배상|미반환|재발급/;

/**
 * CONDITIONAL_CLAUSE — 근거 문장에서 "(조건 단어)…시/경우/때" 형태의 조건절
 * 예) "연체 시 연체료" "파손된 경우 배상"
 */
export const CONDITIONAL_CLAUSE = /(양도|분실|파손|훼손|손상|연체|위약|중도\s*해지|중도\s*상환|초과|원상\s*복구|손해\s*배상|미반환)[^.]{0,20}(시|경우|때)/;

/**
 * OPTIONAL_STRONG — 선택했을 때만 내는 돈의 단서
 * 예) "(선택) 필터 교체" "신청 시 월 3,000원" "옵션"
 */
export const OPTIONAL_STRONG = /\(선택\)|선택\s*사항|선택\s*시|신청\s*시|희망\s*시|원하는\s*경우|옵션|특약/;

/**
 * OPTIONAL_WEAK — "이용할 때만" 내는 부가 비용의 단서 (확정 결제가 따로 있을 때만 선택형으로 본다)
 * 예) "락커 이용 시 월 5,000원"
 */
export const OPTIONAL_WEAK = /이용\s*시|사용\s*시|이용하는\s*경우/;

/**
 * PRE_DISCOUNT — 할인을 적용하기 전 금액 ("고정가·확정가"의 정가는 제외)
 * 예) "45,900원(할인전)" "정상가 50,000원" / 아님) "고정가 30,000원"
 */
export const PRE_DISCOUNT = /할인\s*(?:적용\s*)?전|정상\s*가|(?<![고확])정가|프로모션\s*(?:적용\s*)?전|소비자\s*가격?/;

/**
 * DISCOUNT_ITEM — 이름이 "…할인(액·금액·혜택)"으로 끝나는 할인액 자체 (결제 아님)
 * 예) "E규정 할인" "프로모션 할인액" / 아님) "할인 적용 월 렌탈료"
 */
export const DISCOUNT_ITEM = /(?:할인|감면|캐시백)\s*(?:액|금액|혜택)?\s*\)?$/;
/** DISCOUNT_APPLIED — 할인을 적용한 실제 금액의 이름 (예: "할인 적용 월 렌탈료", "할인 후 요금") */
export const DISCOUNT_APPLIED = /할인\s*(?:적용|후)|적용\s*(?:가|금액|후)/;

/**
 * WAIVED — 면제·무료로 적힌 비용
 * 예) "등록비 면제" "설치비 무료" "무상 설치"
 */
export const WAIVED = /면제|무료|무상/;

/**
 * LUMP_SUM — 이용 기간이 아니라 한 번에 내는 돈
 * 예) "1년 회원권 660,000원(일시불)" "보험료 일시납"
 */
export const LUMP_SUM = /일시불|일시납|선납|1회\s*(?:결제|납부)|한\s*번에/;

/** COMPONENT_HINT — "…에 포함", "…으로 구성" (구성항목 단서) */
export const COMPONENT_HINT = /포함|구성/;

/** DECISION_WORDS — 통보기한의 의미: 협의·확인 표현 (통지 표현 없이 이것만 있으면 갱신 여부 확인) */
export const DECISION_WORDS = /협의|확인|논의|결정|상의|합의/;
/** NOTIFY_WORDS — 통보기한의 의미: 통지 표현 */
export const NOTIFY_WORDS = /통지|통보|알려|고지|의사\s*표시|서면으로|신청/;

/** 문구에 "매월 N일"·"N일 지급"·"말일"처럼 그 지급일이 적혀 있는지 */
export function quoteHasPayDay(quote: string, day: number): boolean {
  if (new RegExp(`(?<![0-9])${day}\\s*일`).test(quote)) return true;
  return day >= 28 && /말일|마지막\s*날/.test(quote);
}

/** 문구에 그 날짜가 직접 적혀 있는지 (2026년 10월 20일 · 2026.10.20 · 26-10-20 · 10월 20일) */
export function quoteHasDate(quote: string, iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const md = new RegExp(`(^|\\D)0?${m}\\s*월\\s*0?${d}\\s*일`);
  const ymd = new RegExp(`(^|\\D)(${y}|${String(y).slice(2)})\\s*[.\\-/년]\\s*0?${m}\\s*[.\\-/월]\\s*0?${d}(\\D|$)`);
  return md.test(quote) || ymd.test(quote);
}
