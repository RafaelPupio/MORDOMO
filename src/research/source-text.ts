const MAX_SOURCE_EXCERPT_CHARS = 40_000;

export function normalizeSourceExcerpt(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .slice(0, MAX_SOURCE_EXCERPT_CHARS);
}

function normalizeForQuoteMatch(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteAppearsInSource(source: string, quote: string): boolean {
  if (!quote.trim()) return false;
  return normalizeForQuoteMatch(source).includes(normalizeForQuoteMatch(quote));
}
