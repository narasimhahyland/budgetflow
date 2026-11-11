import nx from '@nx/eslint-plugin';

/**
 * Module boundaries (Nx tags):
 * - scope:web never imports scope:api code; scope:api never imports scope:web; scope:shared imports only scope:shared.
 * - type:domain (libs/domain) imports no external package at all: no framework, database or HTTP code.
 * - type:contracts (libs/contracts) depends only on zod.
 * - type:feature libs never import each other.
 */
const FRAMEWORK_AND_IO = [
  '@angular/*',
  '@nestjs/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'pg',
  'pg-boss',
  'express',
  'jose',
  'rxjs',
  'zod',
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      'tmp/**',
      'libs/api/db/migrations/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            { sourceTag: 'scope:web', onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'] },
            { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            { sourceTag: 'scope:e2e', onlyDependOnLibsWithTags: ['scope:shared'] },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
              allowedExternalImports: [],
              bannedExternalImports: FRAMEWORK_AND_IO,
            },
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: [],
              allowedExternalImports: ['zod'],
            },
            {
              sourceTag: 'type:data',
              onlyDependOnLibsWithTags: ['type:domain'],
              allowedExternalImports: [],
            },
            { sourceTag: 'type:db', onlyDependOnLibsWithTags: ['type:domain'] },
            {
              sourceTag: 'type:api-module',
              onlyDependOnLibsWithTags: [
                'type:api-module',
                'type:db',
                'type:domain',
                'type:contracts',
                'type:data',
              ],
            },
            { sourceTag: 'type:feature', notDependOnLibsWithTags: ['type:feature', 'type:app'] },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: [
                'type:ui',
                'type:data-access',
                'type:domain',
                'type:contracts',
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:contracts', 'type:domain'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Inline component styles are invisible to stylelint, so the same token rules are enforced here.
    files: ['libs/web/**/*.ts', 'apps/web/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['TemplateElement[value.raw', 'Literal[value'].flatMap((node) => [
          {
            selector: `${node}=/var\\(--sat-sys-(info|success|warning|important|neutral)\\)/]`,
            message:
              'This --sat-sys-* token does not exist. Use the -icon variant for fills and borders, or on-*-container for text.',
          },
          {
            selector: `${node}=/font-family\\s*:/]`,
            message: 'Do not declare font-family; Satori already loads the app fonts.',
          },
        ]),
      ],
    },
  },
];
