import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  maxWorkers: 4,
  projects: [
    { test: { name: 'unit', include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'], environment: 'node' } },
    { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 15000 } },
    { test: { name: 'security', include: ['tests/security/**/*.test.ts'], environment: 'node' } },
    { test: { name: 'updates', include: ['tests/updates/**/*.test.ts'], environment: 'node' } },
  ],
} });
