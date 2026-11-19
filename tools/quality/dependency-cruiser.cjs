// CRAFT quality gate: module structure rules. Protected file (see AGENTS.md).
// Existing violations are frozen in dependency-cruiser-known-violations.json.
// Layer draft (production code only; *.test.ts / test-helpers are exempt from layer rules):
//   schema, domain            -> core model, must not depend on higher packages
//   project-fs, git-workspace, state-model, workspace-runtime, indexer, migrations, tasks, agent-core
//   apps/server, tools        -> composition roots
//   apps/web                  -> browser; may only use packages/apps-server through type-only imports
const TEST = '(\\.test\\.tsx?|\\.spec\\.ts|/test-helpers\\.ts|\\.bench\\.ts)$';
const HIGHER_THAN_DOMAIN = '^packages/(project-fs|git-workspace|tasks|indexer|migrations|agent-core|workspace-runtime|state-model)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make initialization order and layering fragile.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'packages-not-to-apps-or-tools',
      severity: 'error',
      comment: 'Reusable packages must not depend on composition roots.',
      from: { path: '^packages/' },
      to: { path: '^(apps|tools|tests|bench)/' },
    },
    {
      name: 'domain-core-is-lowest-layer',
      severity: 'error',
      comment: 'packages/domain and packages/schema hold the core model; they must not import higher packages.',
      from: { path: '^packages/(domain|schema)/', pathNot: TEST },
      to: { path: HIGHER_THAN_DOMAIN },
    },
    {
      name: 'web-uses-backend-types-only',
      severity: 'error',
      comment: 'The browser bundle must not pull Node-side packages at runtime; import types only.',
      from: { path: '^apps/web/', pathNot: TEST },
      to: { path: '^(packages|apps/server)/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'server-not-to-web',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'prod-not-to-tests',
      severity: 'error',
      comment: 'Production modules must not import test files or test helpers.',
      from: { pathNot: TEST },
      to: { path: TEST },
    },
    {
      name: 'prod-not-to-dev-deps',
      severity: 'error',
      comment: 'Production code must not import devDependencies (they are absent in production installs).',
      from: { path: '^(packages|apps|tools)/', pathNot: `${TEST}|^apps/web/vite\\.config\\.ts$` },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|node_modules|\\.tmp|\\.tools|fixtures|tools/quality)/' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json', '.d.ts'],
    },
  },
};
