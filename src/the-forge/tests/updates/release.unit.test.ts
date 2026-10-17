import { describe, expect, it } from 'vitest';
import { archiveLimits, compareVersions, distributionFiles, releaseVersion, requireArchiveListing } from '../../src/plugins/updates/domain/release.ts';
import policy from '../../configs/distribution-policy.json';

describe('stable release contracts', () => {
  it('compares versions numerically rather than lexically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('0.2.0', '0.1.99')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '1.0.0')).toBe(-1);
    expect(() => releaseVersion('0.1.0-rc.1')).toThrow();
    expect(() => releaseVersion('../latest')).toThrow();
  });
  it('reads entry sizes from GNU tar and bsdtar listings', () => {
    const gnu = ['drwxr-xr-x root/root         0 2026-10-11 12:00 bin/', '-rw-r--r-- root/root      1234 2026-10-11 12:00 bin/forge.js'];
    const bsd = ['drwxr-xr-x  0 runner staff       0 Oct 11 12:00 bin/', '-rw-r--r--  0 runner staff    1234 Oct 11  2025 bin/a file.md'];
    expect(() => requireArchiveListing(gnu.join('\n'))).not.toThrow();
    expect(() => requireArchiveListing(bsd.join('\r\n'))).not.toThrow();
  });
  it.each([
    ['a 10 GB entry', '-rw-r--r-- root/root 10737418240 2026-10-11 12:00 bin/bomb.bin', 'unpacks to more than'],
    ['entries summing past the limit', Array.from({ length: 3 }, (_, index) => `-rw-r--r-- root/root ${archiveLimits.bytes / 2} 2026-10-11 12:00 bin/${index}`).join('\n'), 'unpacks to more than'],
    ['too many entries', Array.from({ length: archiveLimits.entries + 1 }, (_, index) => `-rw-r--r-- root/root 1 2026-10-11 12:00 bin/${index}`).join('\n'), 'more than 5000 entries'],
    ['a link', 'lrwxrwxrwx root/root 0 2026-10-11 12:00 bin/link -> /etc/passwd', 'link or special file'],
    ['an unreadable line', '-rw-r--r-- something', 'could not be read'],
  ])('refuses an archive listing with %s before extraction', (_name, listing, message) => {
    expect(() => requireArchiveListing(listing)).toThrow(expect.objectContaining({ code: 'UPDATE_INVALID', message: expect.stringContaining(message) }));
  });
  it('rejects missing assets, duplicate assets and unowned or traversal paths', () => {
    const files = [...policy.requiredAssets];
    expect(distributionFiles({ schemaVersion: 1, files }, policy)).toEqual([...files].sort());
    for (const next of [files.slice(1), [...files, files[0]], [...files, 'plugins/user/main.mjs'], [...files, 'data/docs/../../config.json']]) {
      expect(() => distributionFiles({ schemaVersion: 1, files: next }, policy)).toThrow();
    }
  });
});
