import { describe, expect, it } from 'vitest';
import { parseReportMarkdown, splitInlineBold } from '@/app/staff/(dashboard)/relatorios/markdown';

describe('parseReportMarkdown', () => {
  it('splits a heading, a paragraph, and an unordered list into separate blocks', () => {
    const markdown = [
      '## Resumo da Semana — Igreja da Colina',
      '',
      'Cinco pessoas perguntaram sobre o horário do culto de domingo.',
      '',
      '- Horário do culto de domingo (5x)',
      '- Estacionamento (2x)',
    ].join('\n');

    expect(parseReportMarkdown(markdown)).toEqual([
      { type: 'heading', level: 2, text: 'Resumo da Semana — Igreja da Colina' },
      { type: 'paragraph', text: 'Cinco pessoas perguntaram sobre o horário do culto de domingo.' },
      { type: 'list', ordered: false, items: ['Horário do culto de domingo (5x)', 'Estacionamento (2x)'] },
    ]);
  });

  it('merges consecutive non-blank lines into a single paragraph, joined by a space', () => {
    const markdown = 'Primeira linha.\nSegunda linha, mesma frase.';

    expect(parseReportMarkdown(markdown)).toEqual([
      { type: 'paragraph', text: 'Primeira linha. Segunda linha, mesma frase.' },
    ]);
  });

  it('recognizes an ordered list (both "1." and "1)" markers) as ordered, distinct from unordered', () => {
    expect(parseReportMarkdown('1. Primeiro\n2. Segundo')).toEqual([
      { type: 'list', ordered: true, items: ['Primeiro', 'Segundo'] },
    ]);
    expect(parseReportMarkdown('1) Primeiro\n2) Segundo')).toEqual([
      { type: 'list', ordered: true, items: ['Primeiro', 'Segundo'] },
    ]);
  });

  it('treats "*" and "+" the same as "-" for unordered items', () => {
    expect(parseReportMarkdown('* Um\n+ Dois\n- Três')).toEqual([
      { type: 'list', ordered: false, items: ['Um', 'Dois', 'Três'] },
    ]);
  });

  it('ends one list and starts another when the marker kind switches mid-run', () => {
    const markdown = '- Um\n- Dois\n1. Três\n2. Quatro';

    expect(parseReportMarkdown(markdown)).toEqual([
      { type: 'list', ordered: false, items: ['Um', 'Dois'] },
      { type: 'list', ordered: true, items: ['Três', 'Quatro'] },
    ]);
  });

  it('supports heading levels 1 through 6, using the "#" run length', () => {
    expect(parseReportMarkdown('# Um\n###### Seis')).toEqual([
      { type: 'heading', level: 1, text: 'Um' },
      { type: 'heading', level: 6, text: 'Seis' },
    ]);
  });

  it('does not treat a bare "#" with no following space as a heading (a stray character, not markdown)', () => {
    expect(parseReportMarkdown('#semtag')).toEqual([{ type: 'paragraph', text: '#semtag' }]);
  });

  it('returns an empty array for an empty or whitespace-only body', () => {
    expect(parseReportMarkdown('')).toEqual([]);
    expect(parseReportMarkdown('   \n\n  \n')).toEqual([]);
  });

  it('normalizes CRLF line endings the same as LF', () => {
    expect(parseReportMarkdown('## Título\r\n\r\nTexto.')).toEqual([
      { type: 'heading', level: 2, text: 'Título' },
      { type: 'paragraph', text: 'Texto.' },
    ]);
  });

  it('trims surrounding whitespace on each line', () => {
    expect(parseReportMarkdown('   Texto com espaços ao redor.   ')).toEqual([
      { type: 'paragraph', text: 'Texto com espaços ao redor.' },
    ]);
  });
});

describe('splitInlineBold', () => {
  it('leaves plain text with no markers as a single, non-bold segment', () => {
    expect(splitInlineBold('texto simples')).toEqual([{ text: 'texto simples', bold: false }]);
  });

  it('splits text around one bold span', () => {
    expect(splitInlineBold('antes **negrito** depois')).toEqual([
      { text: 'antes ', bold: false },
      { text: 'negrito', bold: true },
      { text: ' depois', bold: false },
    ]);
  });

  it('handles a bold span at the very start or end with no surrounding plain segment', () => {
    expect(splitInlineBold('**negrito** depois')).toEqual([
      { text: 'negrito', bold: true },
      { text: ' depois', bold: false },
    ]);
    expect(splitInlineBold('antes **negrito**')).toEqual([
      { text: 'antes ', bold: false },
      { text: 'negrito', bold: true },
    ]);
  });

  it('handles multiple bold spans in one line', () => {
    expect(splitInlineBold('**um** meio **dois**')).toEqual([
      { text: 'um', bold: true },
      { text: ' meio ', bold: false },
      { text: 'dois', bold: true },
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(splitInlineBold('')).toEqual([]);
  });
});
