// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import boundaries from 'eslint-plugin-boundaries';

// boundaries v6 object-selector helper: `allow`/`disallow` entries are `{ to: { type } }`.
const to = (...types) => types.map((type) => ({ to: { type } }));

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
    // Architectural layer boundaries: a component must reach the data layer through a service, never
    // import a store directly (the coupling that grows god objects). Specs are exempt.
    files: ['src/app/**/*.ts'],
    // Specs and test fixtures are support code, not app layers. The detection lab is a dev-only
    // diagnostic screen (reached via ?lab) that deliberately reaches into stores — excepted, with a
    // TODO to route it through a service if it ever ships to users.
    ignores: ['**/*.spec.ts', '**/*.fixture.ts', '**/detection/lab/**'],
    plugins: { boundaries },
    settings: {
      // boundaries resolves each import to a file before classifying it; the default node resolver
      // can't follow extensionless TS paths, so a component→store import looks "unknown" and the rule
      // silently passes. The TypeScript resolver fixes that.
      'import/resolver': { typescript: { project: 'tsconfig.json' } },
      'boundaries/include': ['src/app/**/*.ts'],
      'boundaries/ignore': ['**/*.spec.ts', '**/*.fixture.ts', '**/detection/lab/**'],
      // Order matters: a file takes the first type it matches, so specific patterns precede the
      // broad `component` catch-all.
      'boundaries/elements': [
        { type: 'store', mode: 'full', pattern: 'src/app/storage/**/*' },
        {
          type: 'service',
          mode: 'full',
          pattern: ['src/app/**/*.service.ts', 'src/app/**/*.interceptor.ts'],
        },
        {
          type: 'config',
          mode: 'full',
          pattern: ['src/app/app.config.ts', 'src/app/app.routes.ts'],
        },
        {
          // Pure logic + types: no Angular, no DI. Components live in folder==file dirs (caught below).
          type: 'domain',
          mode: 'full',
          pattern: [
            'src/app/photo.ts',
            'src/app/lightroom-types.ts',
            'src/app/tagging/tags.ts',
            'src/app/detection/detectors/**/*.ts', // pure detectors + their contract types
            'src/app/review/selection/unit-selection.ts',
            'src/app/review/fullscreen-viewer/viewer-image.ts',
            'src/app/notifications/heads-up/heads-up.types.ts',
            'src/app/notifications/catalog/*.ts',
            'src/app/notifications/notification-message.ts',
            'src/app/notifications/notification-sender.ts',
            'src/app/notifications/picker.ts',
          ],
        },
        { type: 'component', mode: 'full', pattern: 'src/app/**/*' },
      ],
    },
    rules: {
      'boundaries/no-unknown': 'off', // external packages (rxjs/@angular) aren't elements — noise
      'boundaries/no-unknown-files': 'error', // every app file must classify into a layer
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            // The load-bearing rules: a component reaches data through a service (never a store), and a
            // service never depends back up on a component.
            { from: { type: 'component' }, allow: to('component', 'service', 'domain') },
            { from: { type: 'service' }, allow: to('service', 'store', 'domain') },
            { from: { type: 'store' }, allow: to('store', 'domain') },
            // Domain is pure logic + types: it may only depend on other domain. The persisted/API
            // contract types it needs (FrameSignature, PanoOrientation, DetectedGroup → detection-types;
            // PhotoAsset → lightroom-types) now live in domain modules, so this stays fully closed.
            { from: { type: 'domain' }, allow: to('domain') },
            {
              from: { type: 'config' },
              allow: to('config', 'component', 'service', 'store', 'domain'),
            },
          ],
        },
      ],
    },
  },
  {
    // Debt ceiling for the file that predates the 400-line cap. Pinned at its *current* counted size so
    // it can only shrink, never grow — every PR that touches it must leave it smaller or the same. Lower
    // this number as the file is slimmed; delete the entry once it drops under 400. (app.ts cleared the
    // cap via the service-extraction campaign — 470 → 444 → 425 → 413 → 403 → under 400 — and no longer
    // needs an override.)
    // TODO(god-object): split the dev lab into sub-panels to bring detection-lab.ts under the global cap.
    files: ['src/app/detection/lab/detection-lab/detection-lab.ts'],
    rules: { 'max-lines': ['error', { max: 419, skipBlankLines: true, skipComments: true }] },
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
