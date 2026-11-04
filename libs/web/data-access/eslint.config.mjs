import nx from '@nx/eslint-plugin';
import { createRequire } from 'node:module';
import baseConfig from '../../../eslint.config.mjs';

// The CommonJS build of satori-lint's ESLint plugin (its ESM build cannot resolve its own files).
const satori = createRequire(import.meta.url)('@hylandsoftware/satori-lint/eslint');
const satoriRecommended = satori.configs['flat/recommended'];

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  ...(Array.isArray(satoriRecommended) ? satoriRecommended : [satoriRecommended]),
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'bf', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'bf', style: 'kebab-case' },
      ],
    },
  },
];
