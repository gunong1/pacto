import { defaultTypeForCategory } from '@/domain/contractTypes';
import type { Contract, ContractPayment, ContractRecord } from '@/domain/types';

/**
 * 초기 UI 개발용 mock 계약. (요구사항 §18 예시 + 지출 화면 확인용 계약)
 * 상호명은 화면 확인용 예시이며 실제 계약과 무관하다.
 */

const NOW = '2026-09-01T00:00:00.000Z';

function contract(partial: Partial<Contract> & Pick<Contract, 'id' | 'title' | 'category'>): Contract {
  return {
    contractType: defaultTypeForCategory(partial.category),
    details: {},
    counterparty: null,
    lifecycle: 'active',
    lifecycleChangedOn: null,
    contractDate: null,
    startDate: null,
    endDate: null,
    totalAmount: null,
    autoRenewal: false,
    renewalPeriodMonths: null,
    terminationNoticeDays: null,
    earlyTerminationTerms: null,
    penaltyTerms: null,
    depositAmount: null,
    currency: 'KRW',
    memo: null,
    source: 'upload',
    notificationsEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function payment(partial: Partial<ContractPayment> & Pick<ContractPayment, 'id' | 'contractId' | 'amount' | 'frequency' | 'startsOn'>): ContractPayment {
  return { kind: 'recurring_fee', direction: 'expense', label: '납부금', dayOfMonth: null, monthOfYear: null, endsOn: null, installmentCount: null, isVariable: false, ...partial };
}

export function createMockRecords(): ContractRecord[] {
  return [
    {
      contract: contract({
        id: 'c-car-insurance',
        title: '자동차보험',
        category: 'insurance',
        counterparty: '삼성화재',
        contractDate: '2025-12-20',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        totalAmount: 1_368_000,
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-car-insurance', contractId: 'c-car-insurance', kind: 'premium', label: '연간 보험료', amount: 1_368_000, frequency: 'yearly', dayOfMonth: 1, monthOfYear: 1, startsOn: '2026-01-01' }),
      ],
      events: [],
      documents: [{ id: 'd-car-insurance', contractId: 'c-car-insurance', fileName: '자동차보험_증권.pdf', mimeType: 'application/pdf', sizeBytes: 482_113, storagePath: null, localUri: null, pageCount: 6 }],
      aiChecks: [],
    },
    {
      contract: contract({
        id: 'c-water-purifier',
        title: 'SK매직 정수기',
        category: 'rental',
        counterparty: 'SK매직',
        contractDate: '2026-09-20',
        startDate: '2026-10-01',
        endDate: '2029-09-30',
        earlyTerminationTerms: '의무사용기간(36개월) 내 해지 시 위약금이 발생할 수 있습니다.',
        penaltyTerms: '잔여 렌탈료의 10% 및 설치비',
        createdAt: '2026-09-21T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-water-purifier', contractId: 'c-water-purifier', label: '월 렌탈료', amount: 39_900, frequency: 'monthly', dayOfMonth: 25, startsOn: '2026-10-01' }),
      ],
      events: [],
      documents: [{ id: 'd-water-purifier', contractId: 'c-water-purifier', fileName: '정수기_렌탈계약서.pdf', mimeType: 'application/pdf', sizeBytes: 311_904, storagePath: null, localUri: null, pageCount: 4 }],
      aiChecks: [
        {
          id: 'ai-water-penalty',
          contractId: 'c-water-purifier',
          severity: 'check',
          topic: 'penalty',
          title: '위약금 관련 조건',
          description: '의무사용기간(36개월) 내 해지하는 경우 잔여 렌탈료의 10%와 설치비를 부담하는 것으로 기재되어 있습니다.',
          evidenceQuote: '고객이 의무사용기간 내 계약을 해지하는 경우 잔여 렌탈료의 10%에 해당하는 위약금 및 설치비를 납부한다.',
          evidencePage: 3,
          suggestion: null,
          status: 'new',
        },
      ],
    },
    {
      contract: contract({
        id: 'c-internet',
        title: '인터넷',
        category: 'telecom',
        counterparty: 'KT',
        startDate: '2024-07-01',
        endDate: '2027-06-30',
        autoRenewal: true,
        renewalPeriodMonths: 12,
        createdAt: '2026-08-10T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-internet', contractId: 'c-internet', label: '월 이용료', amount: 38_500, frequency: 'monthly', dayOfMonth: 15, startsOn: '2024-07-01', isVariable: true }),
      ],
      events: [],
      documents: [],
      aiChecks: [],
    },
    {
      contract: contract({
        id: 'c-gym',
        title: '헬스장',
        category: 'membership',
        counterparty: '바디핏 피트니스',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        autoRenewal: true,
        renewalPeriodMonths: 12,
        terminationNoticeDays: 30,
        createdAt: '2026-01-03T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-gym', contractId: 'c-gym', label: '월 회비', amount: 55_000, frequency: 'monthly', dayOfMonth: 5, startsOn: '2026-01-01' }),
      ],
      events: [],
      documents: [{ id: 'd-gym', contractId: 'c-gym', fileName: '헬스장_회원약관.jpg', mimeType: 'image/jpeg', sizeBytes: 1_204_551, storagePath: null, localUri: null, pageCount: 2 }],
      aiChecks: [
        {
          id: 'ai-gym-renewal',
          contractId: 'c-gym',
          severity: 'caution',
          topic: 'auto_renewal',
          title: '자동갱신',
          description: '계약 종료 30일 전까지 해지 의사를 밝히지 않으면 계약이 12개월 자동 연장되는 것으로 기재되어 있습니다. 해지 통보기한을 확인해주세요.',
          evidenceQuote: '회원이 계약 만료 30일 전까지 서면으로 해지 의사를 통지하지 않는 경우 본 계약은 동일 조건으로 12개월간 자동 연장된다.',
          evidencePage: 2,
          suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12 },
          status: 'acknowledged',
        },
      ],
    },
    {
      contract: contract({
        id: 'c-car-loan',
        title: '자동차 할부',
        category: 'vehicle',
        contractType: 'installment',
        counterparty: '현대캐피탈',
        startDate: '2024-05-01',
        endDate: '2029-04-30',
        totalAmount: 40_980_000,
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-car-loan', contractId: 'c-car-loan', kind: 'installment', label: '할부금', amount: 683_000, frequency: 'monthly', dayOfMonth: 10, startsOn: '2024-05-01' }),
      ],
      events: [],
      documents: [],
      aiChecks: [],
    },
    {
      contract: contract({
        id: 'c-mobile',
        title: '휴대폰',
        category: 'telecom',
        counterparty: 'SK텔레콤',
        startDate: '2025-03-01',
        endDate: '2027-02-28',
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-mobile', contractId: 'c-mobile', label: '월 요금', amount: 79_000, frequency: 'monthly', dayOfMonth: 20, startsOn: '2025-03-01', isVariable: true }),
      ],
      events: [],
      documents: [],
      aiChecks: [],
    },
    {
      contract: contract({
        id: 'c-jeonse',
        title: '전세계약',
        category: 'real_estate',
        counterparty: '임대인 김OO',
        contractDate: '2024-12-10',
        startDate: '2025-01-31',
        endDate: '2027-01-30',
        depositAmount: 300_000_000,
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
      dates: [],
      payments: [],
      events: [
        { id: 'e-jeonse-check', contractId: 'c-jeonse', eventType: 'custom', title: '집주인에게 재계약 여부 확인', eventDate: '2026-10-30', amount: null, source: 'user', notificationEnabled: true, completedAt: null },
      ],
      documents: [{ id: 'd-jeonse', contractId: 'c-jeonse', fileName: '전세계약서.pdf', mimeType: 'application/pdf', sizeBytes: 902_331, storagePath: null, localUri: null, pageCount: 5 }],
      aiChecks: [],
    },
    {
      contract: contract({
        id: 'c-ott',
        title: '넷플릭스',
        category: 'subscription',
        counterparty: 'Netflix',
        startDate: '2023-02-12',
        source: 'manual',
        createdAt: '2026-04-01T00:00:00.000Z',
      }),
      dates: [],
      payments: [
        payment({ id: 'p-ott', contractId: 'c-ott', label: '월 구독료', amount: 17_000, frequency: 'monthly', dayOfMonth: 12, startsOn: '2023-02-12' }),
      ],
      events: [],
      documents: [],
      aiChecks: [],
    },
  ];
}
