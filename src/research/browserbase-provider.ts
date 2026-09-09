import 'server-only';

import Browserbase from '@browserbasehq/sdk';
import {
  chromium,
  type Browser,
  type Request as PlaywrightRequest,
} from 'playwright-core';
import {
  PublicResearchProviderError,
  type PublicResearchProvider,
  type RetrievedPublicSource,
} from '@/research/provider';
import { normalizeSourceExcerpt } from '@/research/source-text';
import { parseApprovedPublicUrl, sameApprovedHost } from '@/research/url-policy';

export type BrowserbaseClient = {
  sessions: {
    create(input: Browserbase.SessionCreateParams): Promise<Browserbase.SessionCreateResponse>;
    update(id: string, input: Browserbase.SessionUpdateParams): Promise<unknown>;
  };
};

export type BrowserConnector = (connectUrl: string) => Promise<Browser>;
export type BrowserbaseClientFactory = (options: {
  apiKey: string;
  maxRetries: 0;
  timeout: 20_000;
}) => BrowserbaseClient;

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

function requestIsAllowed(
  request: PlaywrightRequest,
  approvedHosts: ReadonlySet<string>,
): boolean {
  if (request.method() !== 'GET' || BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return false;
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && approvedHosts.has(url.hostname.toLowerCase());
}

function publicUrlOrThrow(value: unknown): URL {
  try {
    return parseApprovedPublicUrl(value);
  } catch {
    throw new PublicResearchProviderError('unsafeUrl');
  }
}

function withoutLeadingWww(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
}

function approvedHostsFor(hostname: string): ReadonlySet<string> {
  const direct = withoutLeadingWww(hostname);
  return new Set([direct, `www.${direct}`]);
}

function preserveSafeProviderError(error: unknown): never {
  if (error instanceof PublicResearchProviderError) throw error;
  throw new PublicResearchProviderError('providerUnavailable');
}

const createClient: BrowserbaseClientFactory = (options) => new Browserbase(options);
const connectOverCDP: BrowserConnector = (connectUrl) => chromium.connectOverCDP(connectUrl);

export function createBrowserbaseProvider(config: {
  apiKey?: string;
  projectId?: string;
  retentionVerified?: boolean;
  createClient?: BrowserbaseClientFactory;
  connectOverCDP?: BrowserConnector;
} = {}): PublicResearchProvider {
  const apiKey = config.apiKey ?? process.env.BROWSERBASE_API_KEY;
  const projectId = config.projectId ?? process.env.BROWSERBASE_PROJECT_ID;
  const retentionVerified = config.retentionVerified
    ?? process.env.RESEARCH_RETENTION_VERIFIED === 'true';
  const makeClient = config.createClient ?? createClient;
  const connect = config.connectOverCDP ?? connectOverCDP;

  return {
    async retrieveApprovedPage(inputUrl: URL): Promise<RetrievedPublicSource> {
      const requestedUrl = publicUrlOrThrow(inputUrl.toString());
      if (!retentionVerified) throw new PublicResearchProviderError('retentionUnverified');
      if (!apiKey || !projectId) throw new PublicResearchProviderError('providerUnavailable');

      const client = makeClient({ apiKey, maxRetries: 0, timeout: 20_000 });
      const allowedDomain = withoutLeadingWww(requestedUrl.hostname);
      const approvedHosts = approvedHostsFor(requestedUrl.hostname);
      let session: Browserbase.SessionCreateResponse | undefined;
      let browser: Browser | undefined;

      try {
        session = await client.sessions.create({
          projectId,
          api_timeout: 60,
          keepAlive: false,
          proxies: false,
          browserSettings: {
            allowedDomains: [allowedDomain],
            blockAds: true,
            ignoreCertificateErrors: false,
            logSession: false,
            recordSession: false,
            solveCaptchas: false,
          },
        });
        browser = await connect(session.connectUrl);
        const context = browser.contexts()[0];
        const page = context?.pages()[0];
        if (!context || !page) throw new PublicResearchProviderError('providerUnavailable');

        context.on('page', (popup) => {
          if (popup !== page) void popup.close().catch(() => undefined);
        });
        page.on('download', (download) => {
          void download.cancel().catch(() => undefined);
        });
        await page.route('**/*', async (route, request) => {
          if (requestIsAllowed(request, approvedHosts)) {
            await route.continue();
          } else {
            await route.abort();
          }
        });

        const response = await page.goto(requestedUrl.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        if (!response?.ok()) throw new PublicResearchProviderError('noUsefulContent');
        await page.waitForTimeout(2_000);

        let finalUrl: URL;
        try {
          finalUrl = new URL(page.url());
        } catch {
          throw new PublicResearchProviderError('unsafeUrl');
        }
        if (!sameApprovedHost(requestedUrl, finalUrl)) {
          throw new PublicResearchProviderError('unsafeUrl');
        }

        const title = normalizeSourceExcerpt(await page.title()).slice(0, 200)
          || finalUrl.hostname;
        const excerpt = normalizeSourceExcerpt(
          await page.locator('body').innerText({ timeout: 5_000 }),
        );
        if (!excerpt) throw new PublicResearchProviderError('noUsefulContent');

        return { title, url: finalUrl.toString(), excerpt };
      } catch (error) {
        preserveSafeProviderError(error);
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch {
            // Cleanup is best effort; release is still attempted below.
          }
        }
        if (session) {
          try {
            await client.sessions.update(session.id, {
              status: 'REQUEST_RELEASE',
              projectId,
            });
          } catch {
            // Never let provider cleanup details replace the finite public result.
          }
        }
      }
    },
  };
}
