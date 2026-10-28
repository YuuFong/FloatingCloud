/* FloatingCloud update checker — stable GitHub Releases only.
 * No background updater, local file writes, or plugin hot replacement.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FloatingCloudUpdater = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';
  const API_URL = 'https://api.github.com/repos/YuuFong/FloatingCloud/releases/latest';
  const RELEASES_URL = 'https://github.com/YuuFong/FloatingCloud/releases';
  function parseVersion(value) {
    const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/i);
    if (!match) return null;
    return { segments: match.slice(1, 4).map(Number), prerelease: match[4] || '' };
  }
  function compareVersions(left, right) {
    const a = parseVersion(left), b = parseVersion(right);
    if (!a || !b) return null;
    for (let i = 0; i < 3; ++i) {
      if (a.segments[i] !== b.segments[i])
        return Math.sign(a.segments[i] - b.segments[i]);
    }
    if (a.prerelease !== b.prerelease) {
      if (!a.prerelease) return 1;
      if (!b.prerelease) return -1;
      const leftIds = a.prerelease.split('.'), rightIds = b.prerelease.split('.');
      for (let i = 0; i < Math.max(leftIds.length, rightIds.length); ++i) {
        if (i >= leftIds.length) return -1;
        if (i >= rightIds.length) return 1;
        const av = leftIds[i], bv = rightIds[i], an = /^\d+$/.test(av), bn = /^\d+$/.test(bv);
        if (an && bn) {
          const delta = Number(av) - Number(bv);
          if (delta) return Math.sign(delta);
        } else if (an !== bn) return an ? -1 : 1;
        else if (av !== bv) return av < bv ? -1 : 1;
      }
    }
    return 0;
  }
  function evaluateRelease(currentVersion, data) {
    if (!data || typeof data !== 'object' || data.draft || data.prerelease)
      throw new Error('无法读取有效的正式版本信息');
    const latestVersion = String(data.tag_name || '').trim();
    const comparison = compareVersions(latestVersion, currentVersion);
    if (comparison === null) throw new Error('发布版本号格式无法识别');
    const asset = Array.isArray(data.assets) && data.assets.some(a =>
      /^FloatingCloud-v\d+\.\d+\.\d+\.plugin$/i.test(String(a?.name || '')));
    return {
      currentVersion, latestVersion: latestVersion.replace(/^v/i, ''),
      updateAvailable: comparison > 0,
      hasPlugin: Boolean(asset),
      releasesUrl: RELEASES_URL
    };
  }
  async function checkLatest(currentVersion, fetchFn, options = {}) {
    if (typeof fetchFn !== 'function') throw new Error('当前环境不支持联网检查');
    const response = await fetchFn(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: options.signal
    });
    if (response.status === 404)
      throw new Error('仓库尚无正式 Release，暂时无法检查更新');
    if (response.status === 403 || response.status === 429)
      throw new Error('GitHub API 请求受限，请稍后再试');
    if (!response.ok) throw new Error('GitHub 访问失败（HTTP ' + response.status + '）');
    return evaluateRelease(currentVersion, await response.json());
  }
  return { API_URL, RELEASES_URL, parseVersion, compareVersions, evaluateRelease, checkLatest };
});
