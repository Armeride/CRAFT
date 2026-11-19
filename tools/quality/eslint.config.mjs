// CRAFT quality gate: type-aware ESLint.
// Protected file: agents must not edit (see AGENTS.md "품질 게이트").
// typescript-eslint needs the TypeScript 6 API, so this config runs from the
// isolated tools/quality package (typescript@6.0.3). The app itself compiles with TS 7.
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import reactHooks from 'eslint-plugin-react-hooks';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TS = ['**/*.{ts,tsx,mts,cts}'];
const scoped = (configs, files = TS) => configs.map(config => ({ ...config, files }));

// Warnings never fail a gate, so every enabled rule is promoted to "error".
// Existing violations are frozen in eslint-suppressions.json instead.
const promote = value => {
  if (value === 'warn' || value === 1) return 'error';
  if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) return ['error', ...value.slice(1)];
  return value;
};
const errorsOnly = config => config.rules
  ? { ...config, rules: Object.fromEntries(Object.entries(config.rules).map(([id, value]) => [id, promote(value)])) }
  : config;

const configs = [
  {
    basePath: ROOT,
    ignores: [
      'dist/**', 'coverage/**', '.tmp/**', '.tools/**', 'node_modules/**', 'tools/quality/**',
      'fixtures/**', 'packages/**/test-fixtures/**',
      // Generated from JSON Schema by `npm run schema:types`; checked by schema:check.
      '**/generated.ts', '**/generated-*.ts',
    ],
  },
  {
    basePath: ROOT,
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
  },
  ...scoped([js.configs.recommended]).map(c => ({ basePath: ROOT, ...c })),
  ...scoped(tseslint.configs.strictTypeChecked).map(c => ({ basePath: ROOT, ...c })),
  {
    basePath: ROOT,
    files: TS,
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // Files outside the app tsconfigs (web tests, e2e, tool configs) are
        // covered by the lint-only tsconfigs in this directory.
        project: [
          'tsconfig.json',
          'apps/web/tsconfig.json',
          'tools/quality/tsconfig.web-tests.json',
          'tools/quality/tsconfig.e2e.json',
          'tools/quality/tsconfig.bench.json',
        ],
        tsconfigRootDir: ROOT,
      },
    },
  },
  { basePath: ROOT, ...regexp.configs['flat/recommended'], files: TS },
  { basePath: ROOT, ...sonarjs.configs.recommended, files: TS },
  { basePath: ROOT, ...security.configs.recommended, files: TS },
  { basePath: ROOT, ...comments.recommended, files: TS },
  {
    basePath: ROOT,
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'no-unsanitized': noUnsanitized, 'react-hooks': reactHooks },
    rules: { ...noUnsanitized.configs.recommended.rules, ...reactHooks.configs.recommended.rules },
  },
  {
    basePath: ROOT,
    files: TS,
    rules: {
      // Promise / unsafe-any safety (already error in strict-type-checked; pinned explicitly).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Agent bypass prevention.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 10,
      }],
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
        arrayLiteralTypeAssertions: 'never',
      }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: false }],

      // Performance / complexity.
      'no-await-in-loop': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],

      // Excluded (high false-positive, no type information). Path safety is
      // enforced by .semgrep/ wrapper rules instead. See tools/quality/README.md.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
];

export default configs.map(errorsOnly);
