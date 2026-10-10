// Flat config: base JS rules + TypeScript rules, with Prettier turning off
// stylistic conflicts (formatting is Prettier's job). `any` is allowed
// project-wide on purpose: TIFY and parts of the OSD/C2PA surfaces are
// untyped, and the ambient declarations model them as such.
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.tmp/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
