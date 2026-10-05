import type { AIProvider } from './ai/provider';
import { MockAIProvider } from './ai/MockAIProvider';
import { MockContractRepository } from './mock/MockContractRepository';
import type { ContractRepository } from './repository';

/**
 * 구현체 선택 지점. Step 5(Supabase), Step 9(실제 AI)에서 여기만 바꾼다.
 */
export const contractRepository: ContractRepository = new MockContractRepository();
export const aiProvider: AIProvider = new MockAIProvider();

export type { AIProvider, ContractRepository };
