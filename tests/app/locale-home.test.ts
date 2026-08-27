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

  it('uses the requested locale for document metadata', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'fr' }) });
    expect(metadata).toMatchObject({
      title: 'MORDOMO — secrétariat IA responsable',
      description: expect.stringContaining('multilingue'),
    });
  });
});
