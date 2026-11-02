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
    // Clara management is experimental. Keep it behind the facade so the
    // feature can be removed without touching core session management.
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'apps/panel/src/**/*.{ts,tsx}',
      'apps/server/src/**/*.ts',
    ],
    ignores: [
      'apps/web/src/features/clara/**',
      'apps/web/src/**/*.test.{ts,tsx}',
      'apps/web/src/router.tsx',
      'apps/web/src/components/layout/sidebar.tsx',
      'apps/web/src/components/layout/app-shell.tsx',
      'apps/web/src/lib/client.ts',
      'apps/panel/src/features/clara/**',
      'apps/panel/src/App.tsx',
      'apps/server/src/clara/**',
      'apps/server/src/index.ts',
      'apps/server/src/runtime/controller.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/clara/**', '**/clara/**'],
              message:
                'Import Clara management only from an approved composition point or the server facade.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['plugins/clara/**/*.ts'],
    rules: {
      // The ledger's row type is intentionally dynamic: SQLite returns
      // null-prototype records whose shape depends on the query.
      '@typescript-eslint/no-explicit-any': 'off',
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
