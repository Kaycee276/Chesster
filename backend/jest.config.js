module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/database/**',
    '!jest.config.js'
  ],
  coverageReporters: ['text', 'lcov', 'clover']
};
