module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Handle module aliases (if any)
    '^obsidian$': '<rootDir>/tests/mocks/obsidian.ts', // Path to your Obsidian mock
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/"
  ],
  globals: {
    'ts-jest': {
      // Optional: specify tsconfig options if different from project's tsconfig.json
      // tsconfig: 'tsconfig.test.json' 
    }
  }
};
