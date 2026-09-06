// Полифиллы DOM-классов, которых нет в React Native (Hermes), но которые msw ≥ 2.10 требует
// уже при загрузке модулей:
//   - `rettime` (зависимость msw) объявляет `class TypedEvent extends MessageEvent`;
//   - `msw/lib/core/ws` на верхнем уровне делает `new BroadcastChannel(...)`, а его тянет
//     любой `import { http } from 'msw'`.
// RN 0.86 ставит глобальные Event, EventTarget, CustomEvent (react-native/src/private/setup/setUpDOM.js),
// но не MessageEvent и BroadcastChannel. Известная проблема: https://github.com/mswjs/mswjs.io/issues/453.
// Модуль чистый (без импортов react-native); вызывается из msw.polyfills.js ДО msw/native.
// Вторая функция файла — installMswResponseBodyShim — про другую беду того же стыка:
// глобальный Response в RN не спецификационный. См. её комментарий и DECISIONS.md (2026-09-06).

type EventCtor = new (type: string, init?: EventInit) => Event;
type EventTargetCtor = new () => EventTarget;

/** Минимально нужное от глобального объекта; в приложении сюда передаётся globalThis. */
export interface DomGlobals {
  Event?: EventCtor;
  EventTarget?: EventTargetCtor;
  MessageEvent?: unknown;
  BroadcastChannel?: unknown;
}

export interface MessageEventInitLike extends EventInit {
  data?: unknown;
  origin?: string;
  lastEventId?: string;
}

export type InstalledPolyfill = 'MessageEvent' | 'BroadcastChannel';

/** Ставит недостающие классы; уже существующие не трогает. Возвращает, что поставил. */
export function installMswDomPolyfills(g: DomGlobals): { installed: InstalledPolyfill[] } {
  const installed: InstalledPolyfill[] = [];

  if (g.MessageEvent === undefined) {
    const BaseEvent = g.Event;
    if (typeof BaseEvent !== 'function') {
      throw new Error('installMswDomPolyfills: global Event is missing (React Native installs it in setUpDOM)');
    }
    // Как react-native/src/private/webapis/html/events/MessageEvent.js, который RN глобально не выставляет.
    class MessageEventPolyfill extends BaseEvent {
      readonly data: unknown;
      readonly origin: string;
      readonly lastEventId: string;
      constructor(type: string, init?: MessageEventInitLike) {
        super(type, init);
        this.data = init?.data;
        this.origin = String(init?.origin ?? '');
        this.lastEventId = String(init?.lastEventId ?? '');
      }
    }
    g.MessageEvent = MessageEventPolyfill;
    installed.push('MessageEvent');
  }

  if (g.BroadcastChannel === undefined) {
    const BaseTarget = g.EventTarget;
    if (typeof BaseTarget !== 'function') {
      throw new Error('installMswDomPolyfills: global EventTarget is missing (React Native installs it in setUpDOM)');
    }
    // Заглушка: msw использует канал только для синхронизации WebSocket-моков между вкладками браузера,
    // в приложении WebSocket не мокаем — сообщения никуда не идут.
    class BroadcastChannelStub extends BaseTarget {
      readonly name: string;
      onmessage: unknown = null;
      onmessageerror: unknown = null;
      constructor(name: string) {
        super();
        this.name = String(name);
      }
      postMessage(_message: unknown): void {}
      close(): void {}
    }
    g.BroadcastChannel = BroadcastChannelStub;
    installed.push('BroadcastChannel');
  }

  return { installed };
}

/** Минимально нужное от глобального объекта для шима ниже. */
export interface ResponseGlobals {
  Response?: unknown;
}

/**
 * Шим `Response.prototype.body` для React Native.
 *
 * Проблема: глобальный `Response` в RN 0.86 — из `whatwg-fetch`
 * (`react-native/Libraries/Network/fetch.js` делает `require('whatwg-fetch')`), а он построен на
 * XMLHttpRequest и **стримов не знает вообще**: слова `ReadableStream` в его исходнике нет,
 * `Response.prototype.body` не существует. Expo SDK 57 подменяет только глобальный `fetch`
 * (`expo/src/winter/runtime.native.ts` → `install('fetch', …)`), а `Headers`/`Request`/`Response`
 * оставляет от RN.
 *
 * Чем это ломает моки: `@mswjs/interceptors` 0.41.9 собирает мок-ответ как
 * `new FetchResponse(decompressResponse(raw) || raw.body, { status, statusText, headers })`
 * (одинаково в node- и browser-сборке). У ответа из `HttpResponse.json(...)` заголовка
 * `content-encoding` нет, поэтому `decompressResponse` возвращает `null` (`createDecompressionStream('')`
 * → `null`), и телом становится `raw.body` — то есть `undefined`. Клиент получает 200 с пустым телом
 * и падает на `res.json()`: «JSON Parse error: Unexpected end of input». Ровно это видел телефон.
 *
 * Что делает шим: отдаёт по `.body` **инициализатор тела** (`_bodyInit` из whatwg-fetch: строка,
 * `Blob`, `null`), а НЕ `ReadableStream`. Это сознательное отступление от спецификации, и оно
 * безопасно ровно потому, что на нашем пути `.body` используется единственным способом — как
 * аргумент конструктора `Response`, который строку/Blob/null принимает. Отдавать настоящий
 * `ReadableStream` нельзя: конструктор `whatwg-fetch` его не понимает и кладёт в тело строку
 * `"[object ReadableStream]"` (проверено).
 *
 * Где шим перестанет быть безопасным: `msw` умеет читать `response.body.getReader()` в
 * `core/utils/internal/observe-response-body-stream.js`, но зовёт его из `RequestHandler.complete`
 * только если резолвер обратился к `finalize` (стриминг, SSE, отложенная очистка). Наши handlers
 * этого не делают. Появится такой handler — шима станет мало.
 *
 * Ставится только если геттера нет: на web и в Node у `Response` тело-стрим есть, и функция — no-op.
 */
export function installMswResponseBodyShim(g: ResponseGlobals): { installed: boolean } {
  const ResponseCtor = g.Response;
  if (typeof ResponseCtor !== 'function') {
    throw new Error('installMswResponseBodyShim: global Response is missing');
  }
  const proto: object = (ResponseCtor as { prototype: object }).prototype;
  if ('body' in proto) return { installed: false };

  Object.defineProperty(proto, 'body', {
    configurable: true,
    get(this: { _bodyInit?: unknown }): unknown {
      // null, а не undefined: msw проверяет `response.body == null` и `=== null`.
      return this._bodyInit === undefined ? null : this._bodyInit;
    },
  });
  return { installed: true };
}
