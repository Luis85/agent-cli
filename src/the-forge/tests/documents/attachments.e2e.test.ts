import { expect, it } from 'vitest';
import { nativeFormats } from '../../src/domain/documents/file.ts';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;

const extensions = [...new Set(Object.entries(nativeFormats).filter(([key]) => !['markdown', 'canvas', 'base'].includes(key)).flatMap(([, ext]) => [...ext]))];

it.each(extensions)('round trips .%s attachments without byte loss', extension => {
    const bytes = Buffer.from([0, 255, 12, 0, 193, 128, 42]);
    const path = `assets/sample.${extension}`;
    expect(cli(['write', path, '--stdin'], bytes).status).toBe(0);
    const read = cli(['read', path]).body.data;
    expect(Buffer.from(read.document.content, 'base64')).toEqual(bytes);
    expect(cli(['write', path, '--content', 'AQID', '--encoding', 'base64', '--if-match', read.revision]).status).toBe(0);
    expect(cli(['read', path]).body.data.document.content).toBe('AQID');
  });
