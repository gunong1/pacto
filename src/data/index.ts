import { isSupabaseConfigured } from '@/lib/env';
import { todayInSeoul } from '@/domain/dates';

import type { AIProvider } from './ai/provider';
import { MockAIProvider } from './ai/MockAIProvider';
import { MockContractRepository } from './mock/MockContractRepository';
import { MockDocumentStore, type DocumentStore } from './documents';
import { MockNotificationStore, SupabaseNotificationStore, type NotificationStore } from './notifications';
import type { ContractRepository } from './repository';
import { supabase } from './supabase/client';
import { SupabaseContractRepository } from './supabase/SupabaseContractRepository';
import { SupabaseAIProvider } from './supabase/SupabaseAIProvider';
import { SupabaseDocumentStore } from './supabase/SupabaseDocumentStore';
import { prepareFile } from './supabase/prepareFile';

/**
 * 구현체 선택 지점.
 * - Supabase 설정됨: 실제 DB (RLS로 본인 계약만)
 * - 미설정: 인메모리 mock (미리보기·UI 개발)
 * AI: Supabase 모드는 서버 함수(analyze-contract), 미리보기는 MockAIProvider(예시 결과).
 */
export const contractRepository: ContractRepository =
  isSupabaseConfigured && supabase ? new SupabaseContractRepository(supabase, () => todayInSeoul()) : new MockContractRepository();
export const documentStore: DocumentStore =
  isSupabaseConfigured && supabase ? new SupabaseDocumentStore(supabase, prepareFile) : new MockDocumentStore();
export const aiProvider: AIProvider = isSupabaseConfigured && supabase ? new SupabaseAIProvider(supabase) : new MockAIProvider();

export const notificationStore: NotificationStore =
  isSupabaseConfigured && supabase ? new SupabaseNotificationStore(supabase) : new MockNotificationStore(() => contractRepository.list());

export type { AIProvider, ContractRepository, DocumentStore, NotificationStore };
