// Jest: проекты по платформам.
// - `core`    — чистый TS ядра (`jest-expo/node`, окружение node).
// - `screens` — экраны (`jest-expo/ios`, RN-окружение) + тесты UI-хелперов.
//
// Почему ядро не под пресетом `jest-expo` (iOS): его окружение задаёт export conditions
// ['require', 'react-native'], под которыми `msw/node` экспортирует null, а `expo/src/winter`
// подменяет fetch на expo/fetch (в Jest — заглушка). См. DECISIONS.md.
// Для `screens` это обходится точечно: `moduleNameMapper` на `msw/lib/node`, а fetch
// восстанавливается в `jest.setup.screens.ts` из бэкапа, который делает `installGlobal`.
const nodePreset = require('jest-expo/node/jest-preset');
const iosPreset = require('jest-expo/ios/jest-preset');

// msw 2.15 в рантайме тянет три пакета без CJS-сборки (ESM-синтаксис); Jest 29 не умеет
// require(esm), поэтому их транспилируем babel-jest'ом, как и свои файлы.
const ESM_ONLY_DEPS = ['rettime', '@open-draft/deferred-promise', 'until-async'];

const BABEL_KEY = '\\.[jt]sx?$';

function withMswEsmDeps(preset, name) {
  const babelTransform = preset.transform[BABEL_KEY];
  if (!babelTransform) {
    throw new Error(`${name}: transform key ${BABEL_KEY} not found — preset changed, update jest.config.js`);
  }
  const [ignoreNodeModules, ...otherIgnores] = preset.transformIgnorePatterns;
  const ignoreWithEsmDeps = ignoreNodeModules.replace('(?!(', `(?!(${ESM_ONLY_DEPS.join('|')}|`);
  if (ignoreWithEsmDeps === ignoreNodeModules) {
    throw new Error(`${name}: transformIgnorePatterns[0] shape changed, update jest.config.js`);
  }
  return {
    moduleFileExtensions: [...preset.moduleFileExtensions, 'mjs', 'cjs'],
    // Ключи transform сливаются с пресетом: .ts/.js идут через пресет, .mjs — через это правило.
    transform: { '\\.m[jt]s$': babelTransform },
    transformIgnorePatterns: [ignoreWithEsmDeps, ...otherIgnores],
  };
}

module.exports = {
  projects: [
    {
      displayName: 'core',
      preset: 'jest-expo/node',
      testMatch: ['<rootDir>/__tests__/core/**/*.test.ts', '<rootDir>/__tests__/ui/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      ...withMswEsmDeps(nodePreset, 'jest-expo/node'),
    },
    {
      displayName: 'screens',
      preset: 'jest-expo/ios',
      testMatch: ['<rootDir>/__tests__/screens/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.screens.ts'],
      moduleNameMapper: {
        // Под conditions ['require','react-native'] `msw/node` экспортирует null — идём напрямую в CJS-сборку.
        '^msw/node$': '<rootDir>/node_modules/msw/lib/node/index.js',
      },
      ...withMswEsmDeps(iosPreset, 'jest-expo/ios'),
    },
  ],
};
