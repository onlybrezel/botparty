// @ts-check
const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');
const nextPlugin = require('@next/eslint-plugin-next');
const path = require('path');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: path.resolve(__dirname, '../../packages/eslint-config'),
  recommendedConfig: js.configs.recommended,
});

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['.next/**', 'node_modules/**', '.turbo/**'],
  },
  ...compat.extends('@botparty/eslint-config'),
  nextPlugin.configs['core-web-vitals'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
