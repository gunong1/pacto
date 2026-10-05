/**
 * Supabase 통합 테스트 (로컬 Supabase 필요: npm run db:start)
 * 실행: npm run test:integration
 */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__integration__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
