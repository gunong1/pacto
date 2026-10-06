import type {
  ContractStatus,
  PaymentFrequency,
  ReviewSeverity,
  ScheduleItemType,
} from './types';

/** 분야 이름은 contractTypes.categoryLabel (공용 레지스트리, 모르는 코드는 '기타') */
export { categoryLabel } from './contractTypes';

export const STATUS_LABEL: Record<ContractStatus, string> = {
  active: '진행중',
  ending_soon: '종료 임박',
  renewal_due: '갱신 예정',
  ended: '종료',
  cancelled: '해지',
};

export const FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  monthly: '매월',
  bimonthly: '2개월마다',
  quarterly: '분기마다',
  semiannual: '6개월마다',
  yearly: '매년',
  one_time: '일시불',
};

export const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  info: '핵심 정보',
  check: '확인 필요',
  caution: '주의 필요',
};

export const EVENT_TYPE_LABEL: Record<ScheduleItemType, string> = {
  payment: '결제',
  contract_start: '시작',
  contract_end: '종료·만기',
  renewal: '자동갱신',
  termination_notice: '통보기한',
  prepare: '확인 시점',
  key_date: '주요 날짜',
  custom: '일정',
};
