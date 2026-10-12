import { describe, expect, it } from 'vitest';
import { compareVersions, distributionFiles, releaseVersion } from '../../src/plugins/updates/domain/release.ts';
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
  it('rejects missing assets, duplicate assets and unowned or traversal paths', () => {
    const files = [...policy.requiredAssets];
    expect(distributionFiles({ schemaVersion: 1, files }, policy)).toEqual([...files].sort());
    for (const next of [files.slice(1), [...files, files[0]], [...files, 'plugins/user/main.mjs'], [...files, 'data/docs/../../config.json']]) {
      expect(() => distributionFiles({ schemaVersion: 1, files: next }, policy)).toThrow();
    }
  });
});
