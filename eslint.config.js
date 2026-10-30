// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.tools.json',
          './packages/*/tsconfig.json',
          './apps/desktop/tsconfig.node.json',
          './apps/desktop/tsconfig.web.json',
          './security-tests/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Reglas de seguridad del proyecto
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'No usar innerHTML: riesgo de XSS. Renderizar con React.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No usar dangerouslySetInnerHTML: riesgo de XSS.',
        },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Interfaz: no puede importar Node ni Electron (corre en sandbox).
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*', 'fs', 'path', 'child_process', 'os'],
              message:
                'La interfaz no tiene acceso a Node ni a Electron: usar la API expuesta por el preload.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/desktop/src/main/**/*.ts',
      'apps/desktop/src/preload/**/*.ts',
      'scripts/**',
      'apps/sandbox-site/**',
      '**/*.config.{js,ts,mjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
