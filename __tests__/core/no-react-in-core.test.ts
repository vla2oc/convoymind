import * as fs from 'node:fs';
import * as path from 'node:path';

// Правило из docs/PHASE1_CORE.md: файлы src/core не импортируют react, react-native, expo-*.
// `msw/native` разрешён — под шаблон не попадает.
const CORE_DIR = path.join(__dirname, '../../src/core');
const FORBIDDEN = /(?:from|require\()\s*['"](?:react|expo)(?:['"]|\/|-)/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

test('src/core не импортирует react / react-native / expo', () => {
  const files = walk(CORE_DIR);
  expect(files.length).toBeGreaterThan(0);

  const offenders = files.filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')));

  expect(offenders.map((f) => path.relative(CORE_DIR, f))).toEqual([]);
});
