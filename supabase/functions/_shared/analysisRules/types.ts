// 분석 결과(앱 형식) 타입 — 서버 정리 규칙과 앱이 함께 쓴다.
import type { BUSINESS_DAY_RULES, CATEGORY_CODES, CHECK_BEHAVIORS, CONTRACT_TYPE_CODES, DIRECTIONS, PAYMENT_KIND_CODES, PAYMENT_OBLIGATIONS } from '../contractRegistry.ts';
import type { CONFIDENCE, DATE_MEANINGS, DateSource, FREQUENCIES, MODEL_SOURCES, SEVERITY } from './vocabulary.ts';

export type Confidence = (typeof CONFIDENCE)[number];
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface Evidence {
  page: number;
  quote: string;
  /** 근거 파일 (첨부 순서 1부터) — 없으면 위치를 모름 */
  file?: number;
}

export interface Extracted {
  value: unknown;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface Classification<T extends string> {
  value: T;
  confidence: Confidence;
  alternatives: T[];
  reason: string | null;
}

export interface ExtractedDate {
  date: string;
  meaning: (typeof DATE_MEANINGS)[number];
  label: string;
  confidence: Confidence;
  sourceType: ModelSource;
  evidence?: Evidence[];
}

/** 실제로 오가지 않는 금액 — 구성 항목은 상위 결제에 붙이고, 합계·참고 금액은 따로 보여준다 */
export interface ExtractedComponent {
  label: string;
  amount: number;
}

export interface ExtractedPayment {
  kind: (typeof PAYMENT_KIND_CODES)[number];
  direction: (typeof DIRECTIONS)[number];
  label: string;
  amount: number;
  frequency: (typeof FREQUENCIES)[number];
  dayOfMonth: number | null;
  /** 계약서에 적힌 지급일(일시불) 또는 첫 결제일. 없으면 null — 앱이 시작일로 계산하고 "확인 필요"로 표시 */
  date: string | null;
  /** date의 출처 — 기준 날짜(contract_date 등)면 date는 그 기준 날짜에서 온 값 (기준 날짜가 없으면 null) */
  dateSource: DateSource | null;
  endDate: string | null;
  installmentCount: number | null;
  isVariable: boolean;
  /** 의무 수준 — confirmed만 캘린더·지출에 반영 */
  obligation: (typeof PAYMENT_OBLIGATIONS)[number];
  /** confirmed가 아니면 언제 내는 돈인지 */
  conditionNote: string | null;
  /** 이 금액을 이루는 하위 항목 (합산하지 않는다) */
  components: ExtractedComponent[];
  /**
   * 금액 확인 필요 사유 — discount_unconfirmed: 계약서 금액이 할인 전(정상가) 금액이라 실제 결제액이 아님.
   * 앱은 이 금액을 결제액으로 채우지 않고 사용자에게 실제 결제액을 입력받는다 (amount는 계약서에 적힌 할인 전 금액)
   */
  amountCheck?: 'discount_unconfirmed' | null;
  businessDayRule: (typeof BUSINESS_DAY_RULES)[number];
  confidence: Confidence;
  sourceType: ModelSource;
  evidence?: Evidence[];
}

export interface ExtractedDetail {
  value: string | number | boolean;
  confidence: Confidence;
  sourceType: ModelSource;
  evidence?: Evidence[];
}

export interface ExtractedCheck {
  severity: (typeof SEVERITY)[number];
  topic: string;
  title: string;
  description: string;
  confidence: Confidence;
  evidenceQuote: string | null;
  evidencePage: number | null;
  /** 근거 파일 순서(0부터) — 앱이 보관된 원본 id로 바꾼다 */
  evidenceFileIndex: number | null;
  /** info: 알아둘 정보 / fixed_event: 날짜가 정해지는 일 / conditional_rule: 조건이 생길 때만 생기는 의무 */
  behavior: (typeof CHECK_BEHAVIORS)[number];
  /** conditional_rule — 사용자가 기준일(예: 퇴직 예정일)을 입력하면 기준일 − offsetDays 일정을 만든다 */
  rule: { condition: string; action: string; offsetDays: number | null } | null;
  relatedDate: string | null;
  suggestion:
    | null
    | { kind: 'set_termination_notice'; terminationNoticeDays: number; autoRenewal: boolean; renewalPeriodMonths: number | null }
    | { kind: 'add_event'; eventType: 'custom'; title: string; eventDate: string };
}

/** 결제에 넣지 않는 금액의 종류 */
export type ReferenceRole = 'total' | 'reference' | 'waived' | 'discount';

export interface AppExtractionResult {
  category: Classification<(typeof CATEGORY_CODES)[number]>;
  contractType: Classification<(typeof CONTRACT_TYPE_CODES)[number]>;
  fields: Record<string, Extracted>;
  dates: ExtractedDate[];
  payments: ExtractedPayment[];
  /** 합계·참고·면제·할인 금액 (결제·지출에 넣지 않음) — waived: 면제된 금액(등록비 면제 등), discount: 할인액 */
  references: (ExtractedComponent & { role: ReferenceRole })[];
  /** 유형별 속성 (DB 키 snake_case) — 앱이 선택된 유형의 스키마로 다시 검증한다 */
  details: Record<string, ExtractedDetail>;
  checks: ExtractedCheck[];
  provider: string;
  promptVersion: string;
}
