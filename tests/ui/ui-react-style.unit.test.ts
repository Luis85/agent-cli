import { expect, it } from 'vitest';
import ts from 'typescript';
import { reactStyleHelper } from '../../src/infrastructure/ui/renderers/react-style.ts';

const source = ts.transpileModule(reactStyleHelper, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const css = new Function(`${source}\nreturn css;`)() as (value: unknown) => Record<string, string>;

it('preserves quoted delimiters and data URLs while converting CSS names for React', () => {
  expect(css('background-image: url("data:image/svg+xml;utf8,<svg></svg>"); content: "a; b: c"; --custom: "one;two"; -ms-transform: rotate(2deg); font-size: 14px')).toEqual({
    backgroundImage: 'url("data:image/svg+xml;utf8,<svg></svg>")', content: '"a; b: c"', '--custom': '"one;two"', msTransform: 'rotate(2deg)', fontSize: '14px',
  });
});

it('retains escaped quotes and ignores CSS comments and incomplete declarations', () => {
  expect(css('content: "a\\";b"; /* explanation; */ color: red; incomplete; :missing; margin:')).toEqual({ content: '"a\\";b"', color: 'red' });
  expect(css(undefined)).toEqual({});
  expect(css(null)).toEqual({});
});
