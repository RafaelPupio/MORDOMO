import type { Browser } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createBrowserbaseProvider,
  type BrowserbaseClientFactory,
  type BrowserConnector,
} from '@/research/browserbase-provider';
import { PublicResearchProviderError } from '@/research/provider';

type RouteHandler = (
  route: { continue: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> },
  request: { method(): string; resourceType(): string; url(): string },
) => Promise<void> | void;

function harness(options: {
  body?: unknown;
  title?: string;
  finalUrl?: string;
  ok?: boolean;
  createError?: Error;
  connectError?: Error;
  gotoError?: Error;
  innerTextError?: Error;
} = {}) {
  let routeHandler: RouteHandler | undefined;
  let popupHandler: ((page: { close(): Promise<void> }) => Promise<void> | void) | undefined;
  let downloadHandler: ((download: { cancel(): Promise<void> }) => Promise<void> | void) | undefined;

  const closeBrowser = vi.fn(async () => {});
  const goto = vi.fn(async () => {
    if (options.gotoError) throw options.gotoError;
    return { ok: () => options.ok ?? true };
  });
  const waitForTimeout = vi.fn(async () => {});
  const innerText = vi.fn(async () => {
    if (options.innerTextError) throw options.innerTextError;
    return Object.hasOwn(options, 'body')
      ? options.body
      : 'Fictional Clinic opens Monday at 09:00.';
  });
  const page = {
    route: vi.fn(async (_pattern: string, handler: RouteHandler) => { routeHandler = handler; }),
    on: vi.fn((event: string, handler: typeof downloadHandler) => {
      if (event === 'download') downloadHandler = handler;
    }),
    goto,
    waitForTimeout,
    url: vi.fn(() => options.finalUrl ?? 'https://example.com/about'),
    title: vi.fn(async () => options.title ?? 'Fictional Clinic'),
    locator: vi.fn(() => ({ innerText })),
  };
  const context = {
    pages: vi.fn(() => [page]),
    on: vi.fn((event: string, handler: typeof popupHandler) => {
      if (event === 'page') popupHandler = handler;
    }),
  };
  const browser = {
    contexts: vi.fn(() => [context]),
    close: closeBrowser,
  } as unknown as Browser;

  const createSession = options.createError
    ? vi.fn(async () => { throw options.createError; })
    : vi.fn(async () => ({ id: 'opaque-session', connectUrl: 'wss://opaque-connect-url' }));
  const updateSession = vi.fn(async () => ({}));
  const createClient = vi.fn(() => ({
    sessions: { create: createSession, update: updateSession },
  })) as unknown as BrowserbaseClientFactory;
  const connectOverCDP = (options.connectError
    ? vi.fn(async () => { throw options.connectError; })
    : vi.fn(async () => browser)) as unknown as BrowserConnector;

  return {
    createClient,
    connectOverCDP,
    createSession,
    updateSession,
    closeBrowser,
    goto,
    waitForTimeout,
    innerText,
    get routeHandler() { return routeHandler; },
    get popupHandler() { return popupHandler; },
    get downloadHandler() { return downloadHandler; },
  };
}

function providerWith(testHarness: ReturnType<typeof harness>) {
  return createBrowserbaseProvider({
    apiKey: 'bb-key',
    projectId: 'bb-project',
    retentionVerified: true,
    createClient: testHarness.createClient,
    connectOverCDP: testHarness.connectOverCDP,
  });
}

async function expectProviderCode(promise: Promise<unknown>, code: PublicResearchProviderError['code']) {
  await expect(promise).rejects.toMatchObject({
    name: 'PublicResearchProviderError',
    message: code,
    code,
  });
}

describe('strict Browserbase public research provider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the exact non-retaining session and returns only bounded normalized source text', async () => {
    const testHarness = harness({
      title: ` Clinic\u0000 ${'T'.repeat(220)} `,
      body: `  Fictional\u0000 Clinic  ${'x'.repeat(41_000)} `,
      finalUrl: 'https://www.example.com/about',
    });

    const result = await providerWith(testHarness)
      .retrieveApprovedPage(new URL('https://example.com/about'));

    expect(testHarness.createClient).toHaveBeenCalledWith({
      apiKey: 'bb-key',
      maxRetries: 0,
      timeout: 20_000,
    });
    expect(testHarness.createSession).toHaveBeenCalledWith({
      projectId: 'bb-project',
      api_timeout: 60,
      keepAlive: false,
      proxies: false,
      browserSettings: {
        allowedDomains: ['example.com'],
        blockAds: true,
        ignoreCertificateErrors: false,
        logSession: false,
        recordSession: false,
        solveCaptchas: false,
      },
    });
    expect(testHarness.connectOverCDP).toHaveBeenCalledWith('wss://opaque-connect-url');
    expect(testHarness.goto).toHaveBeenCalledWith('https://example.com/about', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    expect(testHarness.waitForTimeout).toHaveBeenCalledWith(2_000);
    expect(testHarness.innerText).toHaveBeenCalledWith({ timeout: 5_000 });
    expect(testHarness.closeBrowser).toHaveBeenCalledOnce();
    expect(testHarness.updateSession).toHaveBeenCalledWith('opaque-session', {
      status: 'REQUEST_RELEASE',
      projectId: 'bb-project',
    });
    expect(Object.keys(result).sort()).toEqual(['excerpt', 'title', 'url']);
    expect(result.url).toBe('https://www.example.com/about');
    expect(result.title).toHaveLength(200);
    expect(result.title).not.toContain('\u0000');
    expect(result.excerpt).toHaveLength(40_000);
    expect(result.excerpt).not.toContain('\u0000');
  });

  it('fails closed before any SDK call when retention or credentials are missing', async () => {
    const noRetention = harness();
    const retentionProvider = createBrowserbaseProvider({
      apiKey: 'bb-key',
      projectId: 'bb-project',
      retentionVerified: false,
      createClient: noRetention.createClient,
      connectOverCDP: noRetention.connectOverCDP,
    });
    await expectProviderCode(
      retentionProvider.retrieveApprovedPage(new URL('https://example.com/')),
      'retentionUnverified',
    );
    expect(noRetention.createClient).not.toHaveBeenCalled();

    const noCredentials = harness();
    const credentialsProvider = createBrowserbaseProvider({
      retentionVerified: true,
      createClient: noCredentials.createClient,
      connectOverCDP: noCredentials.connectOverCDP,
    });
    await expectProviderCode(
      credentialsProvider.retrieveApprovedPage(new URL('https://example.com/')),
      'providerUnavailable',
    );
    expect(noCredentials.createClient).not.toHaveBeenCalled();
  });

  it.each([
    'http://example.com/',
    'https://user:pass@example.com/',
    'https://example.com/?private=1',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://example.com:8443/',
  ])('rejects unsafe input before creating a provider client: %s', async (value) => {
    const testHarness = harness();

    await expectProviderCode(
      providerWith(testHarness).retrieveApprovedPage(new URL(value)),
      'unsafeUrl',
    );
    expect(testHarness.createClient).not.toHaveBeenCalled();
  });

  it('allows only GET exact/www HTTPS requests and blocks heavy resource types', async () => {
    const testHarness = harness();
    await providerWith(testHarness).retrieveApprovedPage(new URL('https://example.com/'));
    expect(testHarness.routeHandler).toBeTypeOf('function');

    const allowed = [
      ['GET', 'document', 'https://example.com/'],
      ['GET', 'script', 'https://www.example.com/app.js'],
      ['GET', 'xhr', 'https://example.com/api/public'],
    ];
    const blocked = [
      ['POST', 'xhr', 'https://example.com/api'],
      ['GET', 'image', 'https://example.com/logo.png'],
      ['GET', 'media', 'https://example.com/video.mp4'],
      ['GET', 'font', 'https://example.com/font.woff2'],
      ['GET', 'document', 'http://example.com/'],
      ['GET', 'document', 'https://user:pass@example.com/'],
      ['GET', 'document', 'https://docs.example.com/'],
      ['GET', 'document', 'https://localhost/'],
      ['GET', 'document', 'https://127.0.0.1/'],
    ];

    for (const [method, resourceType, url] of allowed) {
      const route = { continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
      await testHarness.routeHandler!(route, { method: () => method, resourceType: () => resourceType, url: () => url });
      expect(route.continue, url).toHaveBeenCalledOnce();
      expect(route.abort, url).not.toHaveBeenCalled();
    }
    for (const [method, resourceType, url] of blocked) {
      const route = { continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
      await testHarness.routeHandler!(route, { method: () => method, resourceType: () => resourceType, url: () => url });
      expect(route.abort, url).toHaveBeenCalledOnce();
      expect(route.continue, url).not.toHaveBeenCalled();
    }
  });

  it('cancels popups and downloads', async () => {
    const testHarness = harness();
    await providerWith(testHarness).retrieveApprovedPage(new URL('https://example.com/'));
    const closePopup = vi.fn(async () => {});
    const cancelDownload = vi.fn(async () => {});

    await testHarness.popupHandler!({ close: closePopup });
    await testHarness.downloadHandler!({ cancel: cancelDownload });

    expect(closePopup).toHaveBeenCalledOnce();
    expect(cancelDownload).toHaveBeenCalledOnce();
  });

  it.each([
    'https://evil.example.net/',
    'https://docs.example.com/',
    'http://example.com/',
    'https://user:pass@example.com/',
  ])('rejects an unsafe final navigation and still releases the session: %s', async (finalUrl) => {
    const testHarness = harness({ finalUrl });

    await expectProviderCode(
      providerWith(testHarness).retrieveApprovedPage(new URL('https://example.com/')),
      'unsafeUrl',
    );
    expect(testHarness.closeBrowser).toHaveBeenCalledOnce();
    expect(testHarness.updateSession).toHaveBeenCalledOnce();
  });

  it('uses the final hostname as title fallback and rejects non-OK or empty content', async () => {
    const fallback = harness({ title: '   ', finalUrl: 'https://www.example.com/' });
    await expect(providerWith(fallback).retrieveApprovedPage(new URL('https://example.com/')))
      .resolves.toMatchObject({ title: 'www.example.com' });

    const notOk = harness({ ok: false });
    await expectProviderCode(
      providerWith(notOk).retrieveApprovedPage(new URL('https://example.com/')),
      'noUsefulContent',
    );
    const empty = harness({ body: ' \n\t ' });
    await expectProviderCode(
      providerWith(empty).retrieveApprovedPage(new URL('https://example.com/')),
      'noUsefulContent',
    );
  });

  it.each([
    ['connect', { connectError: new Error('secret connect failure') }, false],
    ['navigation', { gotoError: new Error('secret navigation failure') }, true],
    ['extraction', { innerTextError: new Error('secret extraction failure') }, true],
    ['normalization', { body: null }, true],
  ] as const)('returns one safe error and releases after %s failure', async (_stage, options, closesBrowser) => {
    const testHarness = harness(options);

    await expectProviderCode(
      providerWith(testHarness).retrieveApprovedPage(new URL('https://example.com/')),
      'providerUnavailable',
    );
    expect(testHarness.updateSession).toHaveBeenCalledOnce();
    expect(testHarness.closeBrowser).toHaveBeenCalledTimes(closesBrowser ? 1 : 0);
  });

  it('does not attempt cleanup when session creation itself fails', async () => {
    const testHarness = harness({ createError: new Error('secret creation failure') });

    await expectProviderCode(
      providerWith(testHarness).retrieveApprovedPage(new URL('https://example.com/')),
      'providerUnavailable',
    );
    expect(testHarness.connectOverCDP).not.toHaveBeenCalled();
    expect(testHarness.closeBrowser).not.toHaveBeenCalled();
    expect(testHarness.updateSession).not.toHaveBeenCalled();
  });
});
