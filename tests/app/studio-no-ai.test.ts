import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps Studio actions out of the model and sensitive-data paths', async () => {
  const actionSource = await readFile(
    resolve(process.cwd(), 'src/app/[locale]/studio/actions.ts'),
    'utf8',
  );

  expect(actionSource).not.toMatch(
    /generateText|streamText|usageLedger|privateItems|password|firecrawl/i,
  );
});
