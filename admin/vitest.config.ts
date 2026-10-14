import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // The app uses the automatic JSX runtime (`jsx: "react-jsx"` in
  // tsconfig.app.json), but vitest resolves the *root* tsconfig.json, which only
  // contains project references and no compilerOptions. Without this the
  // transform emits classic `React.createElement` calls and every component test
  // fails with "React is not defined".
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    // Default to node for pure utils; component tests opt into jsdom per file
    // via `// @vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['./tests/setup-react.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})