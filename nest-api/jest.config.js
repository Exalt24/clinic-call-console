const transform = { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] };
const common = { moduleFileExtensions: ['js', 'json', 'ts'], rootDir: '.', transform, testEnvironment: 'node' };

module.exports = {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...common,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      testTimeout: 30000,
    },
  ],
};
