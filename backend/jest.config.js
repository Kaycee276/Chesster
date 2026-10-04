module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testTimeout: 15000,
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
