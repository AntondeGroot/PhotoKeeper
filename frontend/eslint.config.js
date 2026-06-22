// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  // Build/report output — ESLint flat config doesn't read .gitignore, so ignore these explicitly.
  { ignores: ['dist/', 'coverage/'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...angular.configs.tsRecommended,
      sonarjs.configs.recommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      // Size caps that stop a class growing into a god object one harmless method at a time. The
      // cognitive-complexity rule already guards individual methods; these guard the file/function/class
      // as a whole. Two legacy components exceed 400 and are pinned (not exempted) just below — a frozen
      // ceiling they can only ratchet *down* from. New files get 400 from the start.
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-classes-per-file': ['error', 1],
      'sonarjs/cognitive-complexity': ['error', 15],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },
  {
    // Debt ceilings for the two files that predate the 400-line cap. Pinned at their *current* counted
    // size so they can only shrink, never grow — every PR that touches them must leave them smaller or
    // the same. Lower these numbers as the files are slimmed; delete the entry once it drops under 400.
    // app.ts is mid-campaign (was 470 → 444 → 425 as cohesive clusters are extracted into services);
    // one more small extraction clears it.
    // TODO(god-object): app.ts under 400 (extract the current-unit preview computeds or the
    // session/onboarding cluster); detection-lab.ts under 400 (split the dev lab into sub-panels).
    files: ['src/app/app.ts'],
    rules: { 'max-lines': ['error', { max: 403, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['src/app/detection/detection-lab/detection-lab.ts'],
    rules: { 'max-lines': ['error', { max: 418, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Specs are legitimately long and repetitive (fixtures, provider setup) — the god-object caps
    // don't apply to them.
    files: ['**/*.spec.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
