import { isIP } from 'node:net';

const MAX_URL_LENGTH = 2_048;
const MAX_PATH_LENGTH = 1_024;
const RESERVED_HOST_SUFFIXES = [
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.test',
] as const;

function unsafeUrl(): never {
  throw new Error('unsafeUrl');
}

function unbracketedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function hostnameIsPublic(hostname: string): boolean {
  if (hostname === 'localhost' || !hostname.includes('.') || isIP(unbracketedHostname(hostname))) {
    return false;
  }
  if (RESERVED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  return hostname.length <= 253 && hostname.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

export function parseApprovedPublicUrl(value: unknown): URL {
  if (typeof value !== 'string') unsafeUrl();
  const input = value.trim();
  if (!input || input.length > MAX_URL_LENGTH) unsafeUrl();

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    unsafeUrl();
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.port
    || url.pathname.length > MAX_PATH_LENGTH
    || !hostnameIsPublic(hostname)
  ) {
    unsafeUrl();
  }

  url.hostname = hostname;
  url.port = '';
  return url;
}

function withoutLeadingWww(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
}

export function sameApprovedHost(requested: URL, returned: URL): boolean {
  return returned.protocol === 'https:'
    && !returned.username
    && !returned.password
    && !returned.port
    && hostnameIsPublic(returned.hostname.toLowerCase())
    && withoutLeadingWww(requested.hostname) === withoutLeadingWww(returned.hostname);
}
