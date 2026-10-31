import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'demo/**', 'docs/**', 'node_modules/**', '.superpowers/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    rules: {
      // Intentional bare `catch {}` swallows exist in the original code (e.g. localStorage).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
