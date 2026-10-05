// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { __dirname: 'readonly', Buffer: 'readonly', process: 'readonly', require: 'readonly', console: 'readonly' } },
  },
]);
