import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['artifacts/**', '**/.credentialless/**', '**/.temporary/**', '**/dist/**', '**/node_modules/**', '**/coverage/**', '**/evidence-private/**', '**/reference-private/**', 'playwright-report/**', 'test-results/**', 'design/**', 'apps/web/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx,mjs}'], languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname }, globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly' } } },
);
