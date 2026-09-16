import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Imports that must never appear in `packages/**`. The pure modules are shared
// between client and server; pulling any of these in means the design is wrong.
const FORBIDDEN_IMPORTS = [
  { name: 'react', message: 'packages/** must stay framework-free.' },
  { name: 'react-dom', message: 'packages/** must stay framework-free.' },
  { name: 'express', message: 'packages/** must stay framework-free.' },
  { name: 'socket.io', message: 'packages/** must stay transport-free.' },
  { name: 'socket.io-client', message: 'packages/** must stay transport-free.' },
  { name: 'pg', message: 'packages/** must stay database-free.' },
  { name: 'postgres', message: 'packages/** must stay database-free.' },
  { name: 'drizzle-orm', message: 'packages/** must stay database-free.' },
  { name: '@neondatabase/serverless', message: 'packages/** must stay database-free.' },
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },

  // `eslint .` only walks .js by default; this is what makes it find the source.
  { files: ['**/*.{js,ts}'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The determinism and boundary rules. A determinism bug fails silently, so it
  // fails the build instead.
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Generator output must be seeded. Thread the RNG through instead.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The pure modules never read the clock. Take time as an argument.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'The pure modules never read the clock. Take time as an argument.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'The pure modules never read the clock. Take time as an argument.',
        },
      ],
      'no-restricted-imports': ['error', { paths: FORBIDDEN_IMPORTS }],
    },
  },

  // The config file itself is plain JS and outside any package tsconfig.
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },

  prettier,
);
