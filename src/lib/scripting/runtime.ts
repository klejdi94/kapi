/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The `pm` scripting runtime — the code that actually runs *inside* a script
 * sandbox, never in the app's own window.
 *
 * `createKapiRuntime` must stay fully self-contained: it may not reference any
 * import, module-level binding or outer helper, because the Node sandbox
 * (`nodeSandbox.ts`) evaluates its *source text* inside a fresh `vm` context,
 * and the browser sandbox (`scriptWorker.ts`) calls it inside a Web Worker
 * that has no Tauri IPC. Either way, the only thing that crosses back to the
 * host is a JSON string handed to `emit` — no host object is ever reachable
 * from a script, so a script can't climb a prototype chain back into the
 * host's realm.
 *
 * Protocol (all strings are JSON):
 *   host → runtime   start(input)               — run one script
 *   runtime → host   emit({type:'send', id, request})
 *   host → runtime   deliver({id, response} | {id, error})
 *   runtime → host   emit({type:'done', result})
 */
export function createKapiRuntime(emit: (message: string) => void, libSources: Record<string, string> = {}) {
  // Captured before any user script runs, so a script that replaces
  // JSON/Object/Promise globals can't change how results are serialised.
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const keysOf = Object.keys;
  const PromiseCtor = Promise;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // uuid and friends want crypto.getRandomValues; a Web Worker has it, a bare
  // vm context doesn't. Random ids don't need a CSPRNG, so fall back to Math.random.
  const realm: any = globalThis;
  if (!realm.crypto || typeof realm.crypto.getRandomValues !== 'function') {
    realm.crypto = {
      getRandomValues: (array: any) => {
        for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
        return array;
      },
    };
  }

  // Libraries are evaluated here, in the sandbox's own realm, the first time a
  // script asks for one — never handed in from the host.
  const libCache: Record<string, any> = {};
  const FunctionCtor = Function;
  function loadLib(name: string): any {
    if (name in libCache) return libCache[name];
    const source = libSources[name];
    if (typeof source !== 'string') return undefined;
    const value = new FunctionCtor(source + '\n;return __kapiLib;')();
    libCache[name] = value;
    return value;
  }

  const pendingSends = new Map<number, (outcome: any) => void>();
  let nextSendId = 1;
  let started = false;

  function send(message: any) {
    emit(stringify(message));
  }

  function show(value: any): string {
    if (typeof value === 'string') return stringify(value);
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'number' && !isFinite(value)) return String(value);
    try {
      const text = stringify(value);
      return text === undefined ? String(value) : text;
    } catch {
      return String(value);
    }
  }

  function typeName(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof RegExp) return 'regexp';
    if (value instanceof Date) return 'date';
    return typeof value;
  }

  function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b; // NaN
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    const ka = keysOf(a);
    const kb = keysOf(b);
    if (ka.length !== kb.length) return false;
    for (const key of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  function lengthOf(value: any): number | undefined {
    if (typeof value === 'string' || Array.isArray(value)) return value.length;
    if (value instanceof Map || value instanceof Set) return value.size;
    return undefined;
  }

  function contains(haystack: any, needle: any, deep: boolean): boolean {
    if (typeof haystack === 'string') return haystack.indexOf(String(needle)) !== -1;
    if (Array.isArray(haystack)) return haystack.some((item) => (deep ? deepEqual(item, needle) : item === needle));
    if (haystack instanceof Set) return haystack.has(needle);
    if (haystack && typeof haystack === 'object') {
      if (needle && typeof needle === 'object') {
        return keysOf(needle).every((key) => (deep ? deepEqual(haystack[key], needle[key]) : haystack[key] === needle[key]));
      }
      return Object.prototype.hasOwnProperty.call(haystack, needle);
    }
    return false;
  }

  /* ---------------------------------------------------- chai-style expect */

  class AssertionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AssertionError';
    }
  }

  function makeAssertion(actual: any, label?: string): any {
    const flags = { negate: false, deep: false, own: false, length: false };
    const prefix = label ? label + ': ' : '';

    const check = (pass: boolean, positive: string, negative: string) => {
      const ok = flags.negate ? !pass : pass;
      if (!ok) throw new AssertionError(prefix + (flags.negate ? negative : positive));
      return assertion;
    };

    const compareNumber = (op: string, n: number, test: (x: number) => boolean) => {
      const subject = flags.length ? lengthOf(actual) : actual;
      const what = flags.length ? 'length of ' + show(actual) + ' (' + show(subject) + ')' : show(subject);
      return check(
        typeof subject === 'number' && test(subject),
        'expected ' + what + ' to be ' + op + ' ' + show(n),
        'expected ' + what + ' not to be ' + op + ' ' + show(n),
      );
    };

    const assertion: any = {};
    const chain = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'];
    for (const word of chain) Object.defineProperty(assertion, word, { get: () => assertion });

    const flag = (name: string, apply: () => void) =>
      Object.defineProperty(assertion, name, {
        get: () => {
          apply();
          return assertion;
        },
      });
    flag('not', () => (flags.negate = !flags.negate));
    flag('deep', () => (flags.deep = true));
    flag('own', () => (flags.own = true));

    const terminal = (name: string, run: () => void) =>
      Object.defineProperty(assertion, name, {
        get: () => {
          run();
          return assertion;
        },
      });
    terminal('ok', () => check(!!actual, 'expected ' + show(actual) + ' to be truthy', 'expected ' + show(actual) + ' to be falsy'));
    terminal('true', () => check(actual === true, 'expected ' + show(actual) + ' to be true', 'expected ' + show(actual) + ' not to be true'));
    terminal('false', () => check(actual === false, 'expected ' + show(actual) + ' to be false', 'expected ' + show(actual) + ' not to be false'));
    terminal('null', () => check(actual === null, 'expected ' + show(actual) + ' to be null', 'expected ' + show(actual) + ' not to be null'));
    terminal('undefined', () => check(actual === undefined, 'expected ' + show(actual) + ' to be undefined', 'expected ' + show(actual) + ' not to be undefined'));
    terminal('NaN', () => check(actual !== actual, 'expected ' + show(actual) + ' to be NaN', 'expected ' + show(actual) + ' not to be NaN'));
    terminal('exist', () => check(actual !== null && actual !== undefined, 'expected ' + show(actual) + ' to exist', 'expected ' + show(actual) + ' not to exist'));
    terminal('empty', () => {
      const len = lengthOf(actual);
      const empty = len !== undefined ? len === 0 : actual && typeof actual === 'object' ? keysOf(actual).length === 0 : false;
      check(empty, 'expected ' + show(actual) + ' to be empty', 'expected ' + show(actual) + ' not to be empty');
    });

    // `.length` / `.lengthOf` are both a chainable flag (`.length.above(2)`)
    // and a method (`.lengthOf(3)`), same as chai.
    const lengthMethod = (n: number) => {
      const len = lengthOf(actual);
      return check(len === n, 'expected ' + show(actual) + ' to have length ' + n + ' but got ' + show(len), 'expected ' + show(actual) + ' not to have length ' + n);
    };
    Object.defineProperty(assertion, 'length', {
      get: () => {
        flags.length = true;
        const callable: any = (n: number) => lengthMethod(n);
        for (const key of Object.getOwnPropertyNames(assertion)) {
          if (key === 'length') continue;
          Object.defineProperty(callable, key, Object.getOwnPropertyDescriptor(assertion, key) as PropertyDescriptor);
        }
        return callable;
      },
    });
    assertion.lengthOf = lengthMethod;

    assertion.equal = assertion.equals = assertion.eq = (expected: any) =>
      flags.deep
        ? assertion.eql(expected)
        : check(actual === expected, 'expected ' + show(actual) + ' to equal ' + show(expected), 'expected ' + show(actual) + ' not to equal ' + show(expected));
    assertion.eql = assertion.eqls = (expected: any) =>
      check(deepEqual(actual, expected), 'expected ' + show(actual) + ' to deeply equal ' + show(expected), 'expected ' + show(actual) + ' not to deeply equal ' + show(expected));
    assertion.a = assertion.an = (type: string) => {
      const actualType = typeName(actual);
      return check(actualType === String(type).toLowerCase(), 'expected ' + show(actual) + ' to be a ' + type + ' but got ' + actualType, 'expected ' + show(actual) + ' not to be a ' + type);
    };
    assertion.include = assertion.includes = assertion.contain = assertion.contains = (expected: any) =>
      check(contains(actual, expected, flags.deep), 'expected ' + show(actual) + ' to include ' + show(expected), 'expected ' + show(actual) + ' not to include ' + show(expected));
    assertion.string = (expected: string) =>
      check(typeof actual === 'string' && actual.indexOf(expected) !== -1, 'expected ' + show(actual) + ' to contain ' + show(expected), 'expected ' + show(actual) + ' not to contain ' + show(expected));
    assertion.match = assertion.matches = (re: RegExp) =>
      check(re.test(String(actual)), 'expected ' + show(actual) + ' to match ' + String(re), 'expected ' + show(actual) + ' not to match ' + String(re));
    assertion.above = assertion.gt = assertion.greaterThan = (n: number) => compareNumber('above', n, (x) => x > n);
    assertion.least = assertion.gte = assertion.greaterThanOrEqual = (n: number) => compareNumber('at least', n, (x) => x >= n);
    assertion.below = assertion.lt = assertion.lessThan = (n: number) => compareNumber('below', n, (x) => x < n);
    assertion.most = assertion.lte = assertion.lessThanOrEqual = (n: number) => compareNumber('at most', n, (x) => x <= n);
    assertion.within = (lo: number, hi: number) => compareNumber('within ' + lo + '..', hi, (x) => x >= lo && x <= hi);
    assertion.oneOf = (list: any[]) =>
      check(list.some((item) => (flags.deep ? deepEqual(item, actual) : item === actual)), 'expected ' + show(actual) + ' to be one of ' + show(list), 'expected ' + show(actual) + ' not to be one of ' + show(list));
    assertion.instanceOf = assertion.instanceof = (ctor: any) =>
      check(actual instanceof ctor, 'expected ' + show(actual) + ' to be an instance of ' + (ctor && ctor.name), 'expected ' + show(actual) + ' not to be an instance of ' + (ctor && ctor.name));
    assertion.property = (name: string, ...rest: any[]) => {
      const has = actual !== null && actual !== undefined && (flags.own ? Object.prototype.hasOwnProperty.call(actual, name) : name in Object(actual));
      const value = has ? actual[name] : undefined;
      if (rest.length === 0) {
        check(has, 'expected ' + show(actual) + ' to have property ' + show(name), 'expected ' + show(actual) + ' not to have property ' + show(name));
      } else {
        const same = flags.deep ? deepEqual(value, rest[0]) : value === rest[0];
        check(
          has && same,
          'expected ' + show(actual) + ' to have property ' + show(name) + ' of ' + show(rest[0]) + (has ? ' but got ' + show(value) : ''),
          'expected ' + show(actual) + ' not to have property ' + show(name) + ' of ' + show(rest[0]),
        );
      }
      // Like chai, a positive `.property()` moves the subject to the property's value.
      return flags.negate ? assertion : makeAssertion(value, label);
    };
    assertion.ownProperty = (name: string, ...rest: any[]) => {
      flags.own = true;
      return assertion.property(name, ...rest);
    };
    assertion.keys = assertion.key = (...args: any[]) => {
      const wanted: string[] = Array.isArray(args[0]) ? args[0] : args;
      const have = actual && typeof actual === 'object' ? keysOf(actual) : [];
      return check(wanted.every((k) => have.indexOf(k) !== -1), 'expected ' + show(actual) + ' to have keys ' + show(wanted), 'expected ' + show(actual) + ' not to have keys ' + show(wanted));
    };
    assertion.members = (list: any[]) => {
      const arr: any[] = Array.isArray(actual) ? actual : [];
      const same = arr.length === list.length && list.every((item) => arr.some((x) => (flags.deep ? deepEqual(x, item) : x === item)));
      return check(same, 'expected ' + show(actual) + ' to have the same members as ' + show(list), 'expected ' + show(actual) + ' not to have the same members as ' + show(list));
    };
    assertion.satisfy = assertion.satisfies = (fn: (value: any) => boolean) =>
      check(!!fn(actual), 'expected ' + show(actual) + ' to satisfy the given function', 'expected ' + show(actual) + ' not to satisfy the given function');
    assertion.throw = assertion.throws = (expected?: any) => {
      let thrown: any = null;
      try {
        actual();
      } catch (err) {
        thrown = err;
      }
      const matches =
        thrown !== null &&
        (expected === undefined ||
          (typeof expected === 'string' && String(thrown && thrown.message).indexOf(expected) !== -1) ||
          (expected instanceof RegExp && expected.test(String(thrown && thrown.message))) ||
          (typeof expected === 'function' && thrown instanceof expected));
      return check(matches, 'expected function to throw' + (expected ? ' ' + show(String(expected)) : ''), 'expected function not to throw');
    };
    return assertion;
  }

  function expect(actual: any, label?: string) {
    return makeAssertion(actual, label);
  }
  (expect as any).fail = (message?: string) => {
    throw new AssertionError(message || 'expect.fail()');
  };

  /* ------------------------------------------------------------ helpers */

  function base64Encode(input: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const str = String(input);
    let out = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i);
      const b = str.charCodeAt(i + 1);
      const c = str.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw new Error('btoa: string contains characters outside of the Latin1 range');
      const triple = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += chars[(triple >> 18) & 63] + chars[(triple >> 12) & 63];
      out += i + 1 < str.length ? chars[(triple >> 6) & 63] : '=';
      out += i + 2 < str.length ? chars[triple & 63] : '=';
    }
    return out;
  }

  function base64Decode(input: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const str = String(input).replace(/[\s=]/g, '');
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const ch of str) {
      const value = chars.indexOf(ch);
      if (value === -1) throw new Error('atob: invalid base64 input');
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buffer >> bits) & 255);
      }
    }
    return out;
  }

  function headerList(rows: [string, string][]) {
    const list = rows.map(([key, value]) => ({ key, value }));
    const find = (name: string) => list.find((h) => h.key.toLowerCase() === String(name).toLowerCase());
    const api: any = {
      get: (name: string) => {
        const row = find(name);
        return row ? row.value : undefined;
      },
      has: (name: string, value?: string) => {
        const row = find(name);
        return !!row && (value === undefined || row.value === value);
      },
      all: () => list.map((h) => ({ key: h.key, value: h.value })),
      toObject: () => {
        const out: Record<string, string> = {};
        for (const h of list) out[h.key] = h.value;
        return out;
      },
      each: (fn: (h: { key: string; value: string }) => void) => list.forEach((h) => fn({ key: h.key, value: h.value })),
      count: () => list.length,
      _rows: list,
    };
    return api;
  }

  function mutableHeaderList(rows: [string, string][], onChange: () => void) {
    const api = headerList(rows);
    const list = api._rows as { key: string; value: string }[];
    const toRow = (header: any, value?: any) =>
      typeof header === 'string' ? { key: header, value: String(value ?? '') } : { key: String(header.key), value: String(header.value ?? '') };
    api.add = (header: any, value?: any) => {
      list.push(toRow(header, value));
      onChange();
    };
    api.upsert = (header: any, value?: any) => {
      const row = toRow(header, value);
      const existing = list.find((h) => h.key.toLowerCase() === row.key.toLowerCase());
      if (existing) existing.value = row.value;
      else list.push(row);
      onChange();
    };
    api.remove = (name: string) => {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].key.toLowerCase() === String(name).toLowerCase()) list.splice(i, 1);
      onChange();
    };
    return api;
  }

  function responseObject(res: any) {
    const headers = headerList(res.headers || []);
    const body: string = res.text || '';
    let parsedJson: any;
    let parsedOk = false;
    const json = () => {
      if (!parsedOk) {
        parsedJson = parse(body);
        parsedOk = true;
      }
      return parsedJson;
    };
    const response: any = {
      code: res.status,
      status: res.statusText,
      headers,
      responseTime: res.timeMs,
      responseSize: body.length,
      text: () => body,
      json,
      reason: () => res.statusText,
    };
    const statusClass = (lo: number, hi: number, word: string) => () => {
      const ok = res.status >= lo && res.status <= hi;
      if (!(responseAssert.negate ? !ok : ok)) {
        throw new AssertionError('expected response to ' + (responseAssert.negate ? 'not ' : '') + 'be ' + word + ' but got ' + res.status);
      }
    };
    const responseAssert: any = { negate: false };
    const to: any = {};
    const have: any = {
      status: (expected: number | string) => {
        const ok = typeof expected === 'number' ? res.status === expected : res.statusText === expected;
        if (!(responseAssert.negate ? !ok : ok)) {
          throw new AssertionError('expected response to ' + (responseAssert.negate ? 'not ' : '') + 'have status ' + show(expected) + ' but got ' + res.status + ' ' + res.statusText);
        }
      },
      header: (name: string, value?: string) => {
        const ok = headers.has(name, value);
        if (!(responseAssert.negate ? !ok : ok)) {
          throw new AssertionError('expected response to ' + (responseAssert.negate ? 'not ' : '') + 'have header ' + show(name) + (value !== undefined ? ' with value ' + show(value) : ''));
        }
      },
      body: (expected?: any) => {
        let ok: boolean;
        if (expected === undefined) ok = body.length > 0;
        else if (expected instanceof RegExp) ok = expected.test(body);
        else if (typeof expected === 'string') ok = body === expected;
        else {
          try {
            ok = deepEqual(json(), expected);
          } catch {
            ok = false;
          }
        }
        if (!(responseAssert.negate ? !ok : ok)) throw new AssertionError('expected response body to ' + (responseAssert.negate ? 'not ' : '') + 'match ' + show(expected));
      },
      jsonBody: (path?: string, value?: any) => {
        let data: any;
        try {
          data = json();
        } catch {
          if (!responseAssert.negate) throw new AssertionError('expected response to have a JSON body');
          return;
        }
        if (path === undefined) return;
        let current = data;
        let found = true;
        for (const part of String(path).split('.')) {
          if (current !== null && typeof current === 'object' && part in current) current = current[part];
          else {
            found = false;
            break;
          }
        }
        const ok = found && (value === undefined || deepEqual(current, value));
        if (!(responseAssert.negate ? !ok : ok)) throw new AssertionError('expected JSON body to ' + (responseAssert.negate ? 'not ' : '') + 'have ' + show(path) + (value !== undefined ? ' = ' + show(value) : ''));
      },
      responseTime: {
        below: (ms: number) => {
          if (!(res.timeMs < ms)) throw new AssertionError('expected response time ' + res.timeMs + 'ms to be below ' + ms + 'ms');
        },
      },
    };
    const be: any = {};
    const classes: [string, number, number][] = [
      ['ok', 200, 299], ['success', 200, 299], ['info', 100, 199], ['redirection', 300, 399],
      ['clientError', 400, 499], ['serverError', 500, 599], ['error', 400, 599],
      ['accepted', 202, 202], ['badRequest', 400, 400], ['unauthorized', 401, 401], ['forbidden', 403, 403],
      ['notFound', 404, 404], ['rateLimited', 429, 429],
    ];
    for (const [word, lo, hi] of classes) Object.defineProperty(be, word, { get: () => statusClass(lo, hi, word)() });
    Object.defineProperty(be, 'json', {
      get: () => {
        const type = headers.get('content-type') || '';
        if (!(responseAssert.negate ? type.indexOf('json') === -1 : type.indexOf('json') !== -1)) {
          throw new AssertionError('expected response to ' + (responseAssert.negate ? 'not ' : '') + 'be JSON but Content-Type is ' + show(type));
        }
      },
    });
    to.have = have;
    to.be = be;
    Object.defineProperty(to, 'not', {
      get: () => {
        responseAssert.negate = true;
        return to;
      },
    });
    Object.defineProperty(response, 'to', {
      get: () => {
        responseAssert.negate = false;
        return to;
      },
    });
    return response;
  }

  function sendRequestOutcome(request: any): Promise<any> {
    const id = nextSendId++;
    const normalized =
      typeof request === 'string'
        ? { method: 'GET', url: request, headers: [], body: '' }
        : {
            method: String((request && request.method) || 'GET').toUpperCase(),
            url: String((request && request.url) || ''),
            headers: normalizeHeaders(request && request.header !== undefined ? request.header : request && request.headers),
            body: normalizeBody(request && request.body),
          };
    return new PromiseCtor((resolve) => {
      pendingSends.set(id, resolve);
      send({ type: 'send', id, request: normalized });
    });
  }

  function normalizeHeaders(headers: any): [string, string][] {
    if (!headers) return [];
    if (Array.isArray(headers)) {
      return headers
        .map((h: any) => (Array.isArray(h) ? [String(h[0]), String(h[1])] : [String(h.key), String(h.value ?? '')]))
        .filter((h: any) => h[0]) as [string, string][];
    }
    if (typeof headers === 'object') return keysOf(headers).map((k) => [k, String(headers[k])] as [string, string]);
    return [];
  }

  function normalizeBody(body: any): string {
    if (body === undefined || body === null) return '';
    if (typeof body === 'string') return body;
    if (body.mode === 'raw') return String(body.raw ?? '');
    if (body.mode === 'urlencoded' && Array.isArray(body.urlencoded)) {
      return body.urlencoded.map((p: any) => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value ?? '')).join('&');
    }
    if (body.mode === 'graphql' && body.graphql) return stringify(body.graphql);
    return stringify(body);
  }

  /* --------------------------------------------------------------- run */

  function start(inputJson: string) {
    if (started) throw new Error('runtime already used');
    started = true;
    const input = parse(inputJson);

    const logs: string[] = [];
    const tests: { name: string; passed: boolean; error: string | null }[] = [];
    let error: string | null = null;
    let outstanding = 0;
    let scriptSettled = false;
    let finished = false;

    const stores = {
      environment: input.environment as Record<string, string>,
      globals: input.globals as Record<string, string>,
      collectionVariables: input.collectionVariables as Record<string, string>,
    };
    const local: Record<string, string> = {};
    const data: Record<string, string> = input.iterationData || {};
    const requestState = { url: String(input.request.url), headersChanged: false, urlChanged: false };

    const finish = () => {
      if (finished || !scriptSettled || outstanding > 0) return;
      finished = true;
      send({
        type: 'done',
        result: {
          environment: stores.environment,
          globals: stores.globals,
          collectionVariables: stores.collectionVariables,
          request: {
            url: requestState.urlChanged ? requestState.url : null,
            headers: requestState.headersChanged ? requestHeaders._rows.map((h: any) => [h.key, h.value]) : null,
          },
          logs,
          tests,
          error,
        },
      });
    };

    const track = (promise: Promise<any>) => {
      outstanding++;
      promise.then(
        () => {
          outstanding--;
          finish();
        },
        (err: any) => {
          if (error === null) error = describeError(err);
          outstanding--;
          finish();
        },
      );
    };

    const describeError = (err: any) => (err && err.message ? (err.name && err.name !== 'Error' ? err.name + ': ' : '') + err.message : String(err));

    const lookup = (name: string): string | undefined => {
      if (name in local) return local[name];
      if (name in data) return String(data[name]);
      if (name in stores.environment) return stores.environment[name];
      if (name in stores.collectionVariables) return stores.collectionVariables[name];
      if (name in stores.globals) return stores.globals[name];
      return undefined;
    };
    const replaceIn = (resolver: (name: string) => string | undefined) => (template: any) =>
      String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, name) => {
        const value = resolver(name);
        return value === undefined ? match : value;
      });

    const makeScope = (store: Record<string, string>, extra?: Record<string, any>) => ({
      get: (key: string) => store[key],
      set: (key: string, value: unknown) => {
        store[String(key)] = typeof value === 'string' ? value : value !== null && typeof value === 'object' ? stringify(value) : String(value);
      },
      unset: (key: string) => {
        delete store[key];
      },
      has: (key: string) => Object.prototype.hasOwnProperty.call(store, key),
      clear: () => {
        for (const key of keysOf(store)) delete store[key];
      },
      toObject: () => ({ ...store }),
      replaceIn: replaceIn((name) => store[name]),
      ...(extra || {}),
    });

    const requestHeaders = mutableHeaderList(input.request.headers || [], () => (requestState.headersChanged = true));
    const requestObject: any = {
      method: input.request.method,
      headers: requestHeaders,
      name: input.info && input.info.requestName,
      addHeader: (header: any) => requestHeaders.add(header),
      removeHeader: (name: string) => requestHeaders.remove(name),
      upsertHeader: (header: any) => requestHeaders.upsert(header),
    };
    Object.defineProperty(requestObject, 'url', {
      get: () => {
        const url: any = {
          toString: () => requestState.url,
          getHost: () => {
            const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(requestState.url);
            return m ? m[1] : '';
          },
          getPath: () => {
            const m = /^[a-z]+:\/\/[^/?#]*([^?#]*)/i.exec(requestState.url);
            return m && m[1] ? m[1] : '/';
          },
          update: (next: string) => {
            requestState.url = String(next);
            requestState.urlChanged = true;
          },
        };
        return url;
      },
      set: (next: any) => {
        requestState.url = String(next);
        requestState.urlChanged = true;
      },
    });

    const response = input.response ? responseObject(input.response) : undefined;

    const runTest = (name: string, fn: () => any) => {
      const record = (err: any) => tests.push({ name: String(name), passed: !err, error: err ? describeError(err) : null });
      let result: any;
      try {
        result = fn();
      } catch (err) {
        record(err);
        return;
      }
      if (result && typeof result.then === 'function') {
        outstanding++;
        PromiseCtor.resolve(result).then(
          () => {
            record(null);
            outstanding--;
            finish();
          },
          (err: any) => {
            record(err);
            outstanding--;
            finish();
          },
        );
      } else {
        record(null);
      }
    };
    const test: any = (name: string, fn: () => any) => runTest(name, fn);
    test.skip = (name: string) => logs.push('[skipped] ' + name);

    const pm: any = {
      environment: makeScope(stores.environment, { name: input.environmentName || '' }),
      globals: makeScope(stores.globals),
      collectionVariables: makeScope(stores.collectionVariables),
      iterationData: {
        get: (key: string) => data[key],
        has: (key: string) => Object.prototype.hasOwnProperty.call(data, key),
        toObject: () => ({ ...data }),
      },
      variables: {
        get: (key: string) => lookup(key),
        set: (key: string, value: unknown) => {
          local[String(key)] = typeof value === 'string' ? value : stringify(value);
        },
        has: (key: string) => lookup(key) !== undefined,
        unset: (key: string) => {
          delete local[key];
        },
        toObject: () => ({ ...stores.globals, ...stores.collectionVariables, ...stores.environment, ...data, ...local }),
        replaceIn: replaceIn(lookup),
      },
      info: {
        eventName: input.phase === 'test' ? 'test' : 'prerequest',
        iteration: (input.info && input.info.iteration) || 0,
        iterationCount: (input.info && input.info.iterationCount) || 1,
        requestName: (input.info && input.info.requestName) || '',
        requestId: (input.info && input.info.requestId) || '',
      },
      request: requestObject,
      response,
      test,
      expect,
      sendRequest: (request: any, callback?: (err: any, res: any) => void) => {
        const promise = sendRequestOutcome(request).then((outcome) => {
          if (outcome.error) {
            const err = new Error(outcome.error);
            if (callback) {
              callback(err, null);
              return undefined;
            }
            throw err;
          }
          const res = responseObject(outcome.response);
          if (callback) callback(null, res);
          return res;
        });
        // Callback style: the request is tracked so the script phase waits for
        // it. Promise style (`await pm.sendRequest(...)`) is awaited by the
        // script itself, which keeps the script's own promise pending.
        if (callback) track(promise);
        return promise;
      },
      cookies: { get: () => undefined, has: () => false, toObject: () => ({}) },
    };

    // Legacy (pre-`pm`) Postman globals still found in older exported collections.
    const legacyTests: Record<string, any> = {};
    const postman = {
      setEnvironmentVariable: (k: string, v: unknown) => pm.environment.set(k, v),
      getEnvironmentVariable: (k: string) => pm.environment.get(k),
      clearEnvironmentVariable: (k: string) => pm.environment.unset(k),
      setGlobalVariable: (k: string, v: unknown) => pm.globals.set(k, v),
      getGlobalVariable: (k: string) => pm.globals.get(k),
      clearGlobalVariable: (k: string) => pm.globals.unset(k),
      getResponseHeader: (name: string) => (response ? response.headers.get(name) : undefined),
    };

    const write = (level: string) => (...args: any[]) =>
      logs.push((level ? '[' + level + '] ' : '') + args.map((a) => (typeof a === 'string' ? a : show(a))).join(' '));
    const scriptConsole = { log: write(''), info: write(''), debug: write(''), warn: write('warn'), error: write('error') };

    const unsupported = (name: string) => () => {
      throw new Error(name + ' is not available in kapi scripts');
    };
    const builtins: Record<string, () => any> = {
      atob: () => base64Decode,
      btoa: () => base64Encode,
      chai: () => ({ expect }),
    };
    const available = keysOf(libSources).concat(keysOf(builtins)).sort();
    const sandboxRequire = (name: string) => {
      const id = String(name);
      if (id in builtins) return builtins[id]();
      const lib = loadLib(id);
      if (lib !== undefined) return lib;
      throw new Error("require('" + id + "') is not available in kapi scripts. Available: " + available.join(', '));
    };

    // Old Postman scripts use these as globals. Only loaded when the script mentions them.
    const script = String(input.script);
    const lodashGlobal = /(^|[^\w$.])_\s*\.\s*[A-Za-z]/.test(script) ? loadLib('lodash') : undefined;
    const cryptoGlobal = /\bCryptoJS\b/.test(script) ? loadLib('crypto-js') : undefined;
    const xml2Json = (xml: string) => {
      const xml2js = loadLib('xml2js');
      let result: any;
      let failure: any;
      new xml2js.Parser({ explicitArray: false, async: false }).parseString(String(xml), (err: any, out: any) => {
        failure = err;
        result = out;
      });
      if (failure) throw failure;
      return result;
    };

    const params = ['pm', 'console', 'postman', 'tests', 'require', 'btoa', 'atob', 'responseBody', 'responseCode', 'responseTime', 'responseHeaders', 'setTimeout', 'setInterval', 'fetch', '_', 'CryptoJS', 'xml2Json'];
    const args = [
      pm,
      scriptConsole,
      postman,
      legacyTests,
      sandboxRequire,
      base64Encode,
      base64Decode,
      input.response ? input.response.text : undefined,
      input.response ? { code: input.response.status, name: input.response.statusText } : undefined,
      input.response ? input.response.timeMs : undefined,
      input.response ? (response as any).headers.toObject() : undefined,
      unsupported('setTimeout'),
      unsupported('setInterval'),
      unsupported('fetch (use pm.sendRequest)'),
      lodashGlobal,
      cryptoGlobal,
      xml2Json,
    ];

    let scriptPromise: Promise<any>;
    try {
      // The script runs in its own block, so `const _ = require('lodash')` can
      // shadow the legacy globals passed in as parameters instead of clashing.
      const fn = new AsyncFunction(...params, '"use strict";\n{\n' + script + '\n}');
      scriptPromise = fn(...args);
    } catch (err) {
      scriptPromise = PromiseCtor.reject(err);
    }
    scriptPromise.then(
      () => settle(null),
      (err: any) => settle(err),
    );

    function settle(err: any) {
      if (err && error === null) error = describeError(err);
      for (const name of keysOf(legacyTests)) {
        tests.push({ name, passed: !!legacyTests[name], error: legacyTests[name] ? null : 'tests["' + name + '"] was falsy' });
      }
      scriptSettled = true;
      finish();
    }
  }

  function deliver(messageJson: string) {
    const message = parse(messageJson);
    const resolve = pendingSends.get(message.id);
    if (!resolve) return;
    pendingSends.delete(message.id);
    resolve(message);
  }

  return { start, deliver };
}
