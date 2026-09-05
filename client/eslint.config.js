import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'test-results', 'playwright-report']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Core `no-unused-vars` does not know that `<Foo />` reads `Foo`. Without
      // this the only way to keep components from being reported is to exempt
      // every capitalized name — which also hides the ones that really are
      // unused. This rule marks JSX-referenced identifiers as used, so the
      // pattern below can be limited to what it is actually for.
      'react/jsx-uses-vars': 'error',
      // Deliberately-ignored bindings are marked with a leading underscore:
      // `catch (_error)`, or a positional argument kept only to reach the next.
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // A context provider and the hook that reads it belong in one file — moving
  // the hook out to satisfy Fast Refresh would split one concept across two
  // files and change every import site for no runtime benefit. The rule takes
  // an explicit allowance for exactly this, which is narrower than switching
  // it off: any OTHER non-component export from these files is still an error.
  {
    files: ['src/contexts/*.jsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['useAuth', 'useSocket', 'useWorkspace'] },
      ],
    },
  },
  // Same shape for the shadcn/ui primitives, which export a component beside
  // the `cva` variant table that types its props.
  {
    files: ['src/components/ui/*.jsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['buttonVariants', 'badgeVariants', 'toggleVariants'] },
      ],
    },
  },
  // Config and tooling files run in Node, not the browser.
  {
    files: ['*.config.js', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
