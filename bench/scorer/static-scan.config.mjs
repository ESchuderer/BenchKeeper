// The one ESLint flat config of the static scan, owned by the scorer: the app's own ESLint config is never used.
import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';
import globals from 'globals';

export const makeConfig = (sourceType) => [
  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType, globals: { ...globals.browser, ...globals.node } } },
];
