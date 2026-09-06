#!/usr/bin/env node
/**
 * Воспроизведение двух багов msw/native в React Native — и проверка, что полифиллы их закрывают.
 *
 * Зачем скрипт, а не Jest: под Jest глобальные MessageEvent/BroadcastChannel/Response берутся из
 * Node и оба бага не воспроизводятся. Здесь глобалы подменяются на то, что реально кладёт в них
 * RN 0.86: whatwg-fetch (react-native/Libraries/Network/fetch.js делает require('whatwg-fetch')),
 * а модули msw резолвятся с условием `react-native`, как их резолвит Metro на iOS/Android.
 * Это НЕ эмуляция Hermes: движок остаётся V8. Проверяются резолв, набор глобалов и форма ответа —
 * не весь рантайм телефона. Единственная настоящая проверка — запуск в Expo Go.
 *
 * Запуск:  node scripts/msw-native-repro.cjs
 * Выход:   0 — фикс работает; 1 — что-то из проверок не сошлось.
 *
 * Скрипт диагностический: он намеренно тянет whatwg-fetch (транзитивная зависимость react-native,
 * в package.json её нет) — именно потому, что проверяет поведение того самого класса.
 * См. docs/DECISIONS.md (2026-09-06) и src/core/mocks/domPolyfills.ts.
 */
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VARIANT = process.argv[2];

if (!VARIANT) {
  // Каждый вариант — в своём процессе: шим правит прототип насовсем.
  let failed = 0;
  for (const variant of ['bare', 'fixed']) {
    const r = spawnSync(process.execPath, ['--conditions=react-native', __filename, variant], {
      stdio: 'inherit',
    });
    if (r.status !== 0) failed++;
  }
  process.exit(failed === 0 ? 0 : 1);
}

// 1. Собираем сам модуль полифиллов (а не его копию) во временную папку.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convoymind-msw-repro-'));
execFileSync(
  'npx',
  ['tsc', '--ignoreConfig', 'src/core/mocks/domPolyfills.ts', '--outDir', outDir,
   '--module', 'commonjs', '--target', 'es2022', '--lib', 'es2022,dom', '--skipLibCheck'],
  { cwd: ROOT, stdio: 'inherit' },
);
const polyfills = require(path.join(outDir, 'domPolyfills.js'));

// 2. Глобалы как в RN 0.86.
delete globalThis.MessageEvent;
delete globalThis.BroadcastChannel;
const wf = require(path.join(ROOT, 'node_modules', 'whatwg-fetch'));
globalThis.fetch = wf.fetch;
globalThis.Headers = wf.Headers;
globalThis.Request = wf.Request;
globalThis.Response = wf.Response;

// MessageEvent/BroadcastChannel нужны просто чтобы msw загрузился — без них не проверить тело ответа.
polyfills.installMswDomPolyfills(globalThis);
if (VARIANT === 'fixed') {
  const { installed } = polyfills.installMswResponseBodyShim(globalThis);
  console.log(`[fixed] шим Response.prototype.body поставлен: ${installed}`);
}

// 3. Тот же путь, что в приложении: msw/native + HttpResponse.json.
const { setupServer } = require(path.join(ROOT, 'node_modules', 'msw', 'native'));
const { http, HttpResponse } = require(path.join(ROOT, 'node_modules', 'msw'));

const server = setupServer(
  http.post('https://api.tomtom.com/maps/orbis/routing/calculateRoute/:locations/json', () =>
    HttpResponse.json({ routes: [{ summary: { travelTimeInSeconds: 42 } }] })),
  http.get('https://mock.convoy-mind.local/v1/parkings', () =>
    HttpResponse.json({ parkings: [{ id: 'mock-1' }] })),
  http.get('https://x.test/403', () => HttpResponse.json({ error: 'missing key' }, { status: 403 })),
  http.get('https://x.test/204', () => new HttpResponse(null, { status: 204 })),
);
server.listen({ onUnhandledRequest: 'error' });

(async () => {
  const problems = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`[${VARIANT}] ${name}: ${ok ? 'ok' : 'НЕ СОШЛОСЬ'} → ${JSON.stringify(actual)}`);
    if (!ok) problems.push(name);
  };

  let routeBody = null;
  let routeError = null;
  try {
    const res = await fetch('https://api.tomtom.com/maps/orbis/routing/calculateRoute/1,2:3,4/json?key=x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ legs: [{ routeStop: { pauseTimeInSeconds: 0 } }] }),
    });
    console.log(`[${VARIANT}] calculateRoute: HTTP ${res.status}, тело = ${JSON.stringify(await res.clone().text())}`);
    routeBody = await res.json();
  } catch (e) {
    routeError = `${e.constructor.name}: ${e.message}`;
    console.log(`[${VARIANT}] calculateRoute: res.json() БРОСИЛ ${routeError}`);
  }

  if (VARIANT === 'bare') {
    // Ожидаем именно ту ошибку, что видел телефон.
    check('баг воспроизводится (пустое тело → SyntaxError)', /Unexpected end of JSON input/.test(routeError ?? ''), true);
  } else {
    check('calculateRoute', routeBody, { routes: [{ summary: { travelTimeInSeconds: 42 } }] });
    check('parkings', await (await fetch('https://mock.convoy-mind.local/v1/parkings')).json(), { parkings: [{ id: 'mock-1' }] });
    const r403 = await fetch('https://x.test/403');
    check('403 с телом ошибки', [r403.status, await r403.json()], [403, { error: 'missing key' }]);
    const r204 = await fetch('https://x.test/204');
    check('204 без тела', [r204.status, await r204.text()], [204, '']);
  }

  server.close();
  fs.rmSync(outDir, { recursive: true, force: true });
  if (problems.length > 0) {
    console.log(`[${VARIANT}] ПРОВАЛ: ${problems.join(', ')}`);
    process.exit(1);
  }
  console.log(`[${VARIANT}] всё сошлось`);
})();
