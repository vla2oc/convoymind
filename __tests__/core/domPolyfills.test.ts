import {
  installMswDomPolyfills,
  installMswResponseBodyShim,
  type DomGlobals,
  type MessageEventInitLike,
  type ResponseGlobals,
} from '../../src/core/mocks/domPolyfills';

// Полифиллы для msw/native в React Native (ошибка с телефона: «Property 'MessageEvent' doesn't exist»).

// Тип конструктора нашего полифилла, а не DOM-класса: у lib.dom `MessageEvent<T>` конструктор
// дженерик, и `class Typed extends (g.MessageEvent as typeof MessageEvent)` даёт TS2508
// («No base constructor has the specified number of type arguments»).
type MessageEventPolyfillCtor = new (
  type: string,
  init?: MessageEventInitLike,
) => Event & { readonly data: unknown; readonly origin: string; readonly lastEventId: string };

describe('installMswDomPolyfills — классы', () => {
  test('ставит MessageEvent и BroadcastChannel на объект, где есть только Event и EventTarget', () => {
    const g: DomGlobals = { Event, EventTarget };

    expect(installMswDomPolyfills(g).installed).toEqual(['MessageEvent', 'BroadcastChannel']);

    const Msg = g.MessageEvent as MessageEventPolyfillCtor;
    const e = new Msg('message', { data: { a: 1 }, origin: 'https://x.test' });
    expect(e).toBeInstanceOf(Event);
    expect(e.type).toBe('message');
    expect(e.data).toEqual({ a: 1 });
    expect(e.origin).toBe('https://x.test');
    expect(e.lastEventId).toBe('');
    // Как rettime: класс-наследник с вызовом super(type, init) и preventDefault().
    class Typed extends Msg {
      constructor(...args: [string, MessageEventInitLike?]) {
        super(args[0], args[1]);
      }
    }
    const t = new Typed('t', { data: 42 });
    expect(t).toBeInstanceOf(Msg);
    expect(t.data).toBe(42);
    expect(() => t.preventDefault()).not.toThrow();

    const Channel = g.BroadcastChannel as typeof BroadcastChannel;
    const ch = new Channel('msw:websocket-client-manager');
    expect(ch).toBeInstanceOf(EventTarget);
    expect(ch.name).toBe('msw:websocket-client-manager');
    expect(() => {
      ch.postMessage('x');
      ch.close();
    }).not.toThrow();
  });

  test('существующие классы не трогает', () => {
    const g: DomGlobals = { Event, EventTarget, MessageEvent, BroadcastChannel };
    expect(installMswDomPolyfills(g).installed).toEqual([]);
    expect(g.MessageEvent).toBe(MessageEvent);
    expect(g.BroadcastChannel).toBe(BroadcastChannel);
  });

  test('без Event / EventTarget — понятная ошибка', () => {
    expect(() => installMswDomPolyfills({ EventTarget })).toThrow('global Event is missing');
    expect(() => installMswDomPolyfills({ Event, MessageEvent })).toThrow('global EventTarget is missing');
  });
});

describe('installMswDomPolyfills — воспроизведение ошибки с телефона', () => {
  test('без MessageEvent/BroadcastChannel msw/native не грузится; с полифиллами — грузится и создаёт сервер', () => {
    const g = globalThis as unknown as DomGlobals;
    const saved = { MessageEvent: g.MessageEvent, BroadcastChannel: g.BroadcastChannel };
    try {
      delete g.MessageEvent;
      delete g.BroadcastChannel;
      expect(() => jest.isolateModules(() => require('msw/native'))).toThrow(/MessageEvent/);

      expect(installMswDomPolyfills(g).installed).toEqual(['MessageEvent', 'BroadcastChannel']);

      let native: typeof import('msw/native') | undefined;
      let core: typeof import('msw') | undefined;
      jest.isolateModules(() => {
        native = require('msw/native');
        core = require('msw');
      });
      const server = native!.setupServer(core!.http.get('https://example.test/native', () => core!.HttpResponse.text('ok')));
      expect(typeof server.listen).toBe('function');
      expect(typeof server.events.on).toBe('function');
    } finally {
      g.MessageEvent = saved.MessageEvent;
      g.BroadcastChannel = saved.BroadcastChannel;
    }
  });
});

describe('installMswResponseBodyShim', () => {
  // Стенд-ин вместо настоящего whatwg-fetch Response: под Jest глобальный Response — из Node,
  // у него тело-стрим есть, и баг там не воспроизводится. Пакет whatwg-fetch в package.json не
  // объявлен (он транзитивный от react-native), поэтому импортировать его в тест нельзя.
  // Сквозная проверка на настоящем классе — scripts/msw-native-repro.cjs (см. DECISIONS.md).
  class WhatwgResponseStandIn {
    _bodyInit?: unknown;
    constructor(body?: unknown) {
      if (body !== undefined) this._bodyInit = body;
    }
  }

  test('ставит геттер body там, где его нет, и отдаёт инициализатор тела', async () => {
    const g: ResponseGlobals = { Response: WhatwgResponseStandIn };
    expect('body' in WhatwgResponseStandIn.prototype).toBe(false);

    expect(installMswResponseBodyShim(g).installed).toBe(true);

    const json = new WhatwgResponseStandIn('{"routes":[]}') as { body: unknown };
    expect(json.body).toBe('{"routes":[]}');
    // Именно эту строку msw передаёт в конструктор Response — она должна давать то же тело.
    await expect(new Response(json.body as string).json()).resolves.toEqual({ routes: [] });
  });

  test('нет тела → null, а не undefined (msw проверяет `body == null` и `=== null`)', () => {
    const g: ResponseGlobals = { Response: WhatwgResponseStandIn };
    installMswResponseBodyShim(g);

    expect((new WhatwgResponseStandIn() as { body: unknown }).body).toBeNull();
    expect((new WhatwgResponseStandIn(null) as { body: unknown }).body).toBeNull();
  });

  test('идемпотентна и не трогает спецификационный Response (web, Node)', () => {
    const g: ResponseGlobals = { Response: WhatwgResponseStandIn };
    installMswResponseBodyShim(g);
    expect(installMswResponseBodyShim(g).installed).toBe(false);

    const before = Object.getOwnPropertyDescriptor(Response.prototype, 'body');
    expect(installMswResponseBodyShim(globalThis as ResponseGlobals).installed).toBe(false);
    expect(Object.getOwnPropertyDescriptor(Response.prototype, 'body')).toEqual(before);
  });

  test('без глобального Response — понятная ошибка', () => {
    expect(() => installMswResponseBodyShim({})).toThrow('global Response is missing');
  });
});
