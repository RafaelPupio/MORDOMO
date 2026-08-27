import { describe, expect, it } from 'vitest';
import { generateMetadata, generateStaticParams } from '@/app/[locale]/page';

describe('localized MORDOMO home route', () => {
  it('pre-renders every non-English presentation route', () => {
    expect(generateStaticParams()).toEqual([
      { locale: 'pt' },
      { locale: 'es' },
      { locale: 'fr' },
      { locale: 'de' },
    ]);
  });

  it('uses each requested locale for document metadata', async () => {
    const expectations = [
      ['pt', 'MORDOMO — secretaria de IA responsável', 'multilíngue'],
      ['es', 'MORDOMO — secretaría de IA responsable', 'multilingüe'],
      ['fr', 'MORDOMO — secrétariat IA responsable', 'multilingue'],
      ['de', 'MORDOMO — verantwortliche KI-Sekretariatsassistenz', 'mehrsprachige'],
    ] as const;

    for (const [locale, title, description] of expectations) {
      await expect(generateMetadata({ params: Promise.resolve({ locale }) })).resolves.toMatchObject({
        title,
        description: expect.stringContaining(description),
      });
    }
  });

  it('rejects unsupported locale metadata with a not-found response', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'it' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
