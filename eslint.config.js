import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/.wrangler/**',
    'apps/web/src/components/ui/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/panel/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // React Compiler diagnostics that conflict with imperative event-store and
      // menu patterns used in this app.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  {
    files: ['apps/server/**/*.ts', 'packages/**/*.ts', 'plugins/**/*.ts', 'workers/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['plugins/clara-policy/**/*.ts'],
    rules: {
      // The OpenCode plugin context is host-provided and intentionally untyped.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['apps/orchestrator/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/server/**/*.ts'],
    rules: {
      // The home agent is a CLI; startup and pairing output belongs on stdout.
      'no-console': 'off',
    },
  },
  {
    files: ['apps/web/vite.config.ts', 'apps/panel/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
])
