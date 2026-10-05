import { isSupabaseConfigured } from '@/lib/env';
import { todayInSeoul } from '@/domain/dates';

import type { AIProvider } from './ai/provider';
import { MockAIProvider } from './ai/MockAIProvider';
import { MockContractRepository } from './mock/MockContractRepository';
import type { ContractRepository } from './repository';
import { supabase } from './supabase/client';
import { SupabaseContractRepository } from './supabase/SupabaseContractRepository';

/**
 * 구현체 선택 지점.
 * - Supabase 설정됨: 실제 DB (RLS로 본인 계약만)
 * - 미설정: 인메모리 mock (미리보기·UI 개발)
 * AI는 Step 9 전까지 항상 MockAIProvider.
 */
export const contractRepository: ContractRepository =
  isSupabaseConfigured && supabase ? new SupabaseContractRepository(supabase, () => todayInSeoul()) : new MockContractRepository();
export const aiProvider: AIProvider = new MockAIProvider();

export type { AIProvider, ContractRepository };
