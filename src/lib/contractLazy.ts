import type { ResponseContract } from '@/types';
import type { TestResult } from './scripting';

/** `contractTests`, loading the validator (Ajv, ~200 KB) only once a request actually has a contract. */
export async function contractTestsLazy(
  contract: ResponseContract | undefined,
  response: { status: number; headers: [string, string][]; text: string; binary?: boolean },
): Promise<TestResult[]> {
  if (!contract?.enabled) return [];
  const { contractTests } = await import('./contract');
  return contractTests(contract, response);
}
