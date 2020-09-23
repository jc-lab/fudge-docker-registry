module.exports = {
  root: true,
  env: {
    node: true,
    browser: false
  },
  settings: {
    'import/resolver': {
      typescript: {},
      node: {
        extensions: [
          '.js',
          '.jsx',
          '.ts',
          '.tsx'
        ]
      }
    }
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: './'
  },
  plugins: [
    '@typescript-eslint',
    'import'
  ],
  extends: [
    'airbnb-base',
    'plugin:@typescript-eslint/eslint-recommended'
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    'import/extensions': 'off',
    'camelcase': 'off',
    'max-classes-per-file': 'off',
    'no-underscore-dangle': 'off',
    'no-async-promise-executor': 'off',
    'no-console': 'off',
    'comma-dangle': ['error', 'never'],
    'no-cond-assign': 'off',
    'max-len': 'off'
  }
};
