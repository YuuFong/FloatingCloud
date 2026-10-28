const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('song-change dispatch does not synchronously reenter the player', async () => {
  const listeners = new Map();
  let dispatching = false;
  let reentered = false;
  let ncmReads = 0;
  let current = { ncmId: 1, songName: 'first' };
  const api = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    getCurrentSong() { if (dispatching) reentered = true; return current; },
    getTimeline() { if (dispatching) reentered = true; return { currentTime: 0 }; },
    getPlaybackStatus() { if (dispatching) reentered = true; return 'Playing'; },
  };
  let onLoad;
  const clock = { anchor() {}, setPlaying() {}, reset() {}, position() { return 0; }, isPlaying() { return true; } };
  const core = {
    parseNcmLyrics() { return { lines: [] }; }, normalizeSettings(x) { return { lyricsMode: 'local-only', localLyricsFolders: '', ...x }; },
    createClock() { return clock; }, isNcmInstrumental() { return false; },
  };
  const context = {
    window: { FloatingCloudCore: core, InfLinkApi: api, addEventListener() {}, betterncm: { ncm: { getPlayingSong() { ++ncmReads; if (dispatching) reentered = true; return null; } } } },
    plugin: { getConfig(_key, fallback) { return fallback; }, setConfig() {}, onLoad(fn) { onLoad = fn; }, onConfig() {}, onUnload() {} },
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval, performance, navigator: { onLine: false }, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/main.js'), 'utf8'), context);
  onLoad();
  current = { ncmId: 2, songName: 'second' };
  dispatching = true;
  listeners.get('songChange')({ detail: current });
  listeners.get('timelineUpdate')({ detail: { currentTime: 10 } });
  listeners.get('playStateChange')({ detail: 'Playing' });
  dispatching = false;
  assert.equal(reentered, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reentered, false);
  assert.equal(ncmReads, 0, 'NCM getPlayingSong must never run on the host renderer');
});

test('displayed and packaged versions match manifest', () => {
  const root = path.join(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'plugin/manifest.json'))).version;
  assert.match(fs.readFileSync(path.join(root, 'plugin/main.js'), 'utf8'), new RegExp(`VERSION = '${version}'`));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'plugin/main.js'), 'utf8'), /\.getPlayingSong/);
  // The CI upload path must be version-agnostic; the packaging script reads manifest.version.
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-build.yml'), 'utf8');
  const packager = fs.readFileSync(path.join(root, 'tools/pack_plugin.py'), 'utf8');
  assert.match(workflow, /path: FloatingCloud-v\\*\\.plugin/);
  assert.match(workflow, /tools\\/validate-plugin-package\\.py/);
  assert.match(packager, /manifest\\['version'\\]/);
});

test('quick settings refresh action reaches the current lyric lookup', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'plugin/desktop.html'), 'utf8');
  const native = fs.readFileSync(path.join(root, 'native/floatingcloud.cpp'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'plugin/main.js'), 'utf8');
  assert.match(html, /data-action="refreshLyrics"[^>]*aria-label="重新获取当前歌词"/);
  assert.match(native, /cmd==L"refreshLyrics"/);
  assert.match(native, /case 11:return "refreshLyrics"/);
  assert.match(main, /action === 'refreshLyrics'\) live\?\.refresh\(\)/);
});

test('diagnostic modes isolate event and window startup without changing saved preferences', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../plugin/main.js'), 'utf8');
  for (const mode of ['inert', 'no-window', 'events-only','timeline-read-only','lyrics-only','http-only']) {
    const listeners = new Map(), calls = [], writes = [];
    const reads = { metadata: 0, timeline: 0 };
    let load;
    const api = {
      addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
      getCurrentSong() { return { ncmId: 7, songName: 'test' }; },
      getTimeline() { ++reads.timeline; return { currentTime: 0 }; }, getPlaybackStatus() { return 'Playing'; },
    };
    const core = {
      parseNcmLyrics() { return { lines: [] }; }, normalizeSettings(x) { return { lyricsMode: 'local-only', localLyricsFolders: '', ...x }; },
      createClock() { return { anchor() {}, setPlaying() {}, reset() {} }; }, isNcmInstrumental() { return false; },
    };
    const context = {
      window: { FloatingCloudCore: core, InfLinkApi: api, addEventListener() {},
        betterncm: { ncm: { getPlayingSong() { ++reads.metadata; return null; } } },
        betterncm_native: { native_plugin: { call(name) { calls.push(name); return 'started'; } } } },
      plugin: {
        getConfig(key, fallback) { return key === 'diagnostic-mode-v1' ? mode : key === 'desktop-visible-v1' ? true : fallback; },
        setConfig(key) { writes.push(key); }, onLoad(fn) { load = fn; }, onConfig() {}, onUnload() {},
      },
      AbortController, setTimeout, clearTimeout, setInterval, clearInterval, performance, navigator: { onLine: false }, console,
    };
    vm.runInNewContext(source, context);
    load();
    if (mode === 'inert') assert.equal(listeners.size, 0);
    else assert.equal(listeners.size, 3);
    assert.equal(calls.includes('floatingcloud.open'), false, `${mode} must not start the native host`);
    if (!['no-window','lyrics-only'].includes(mode)) assert.equal(calls.length, 0, `${mode} must not start native lyrics`);
    assert.deepEqual(writes, []);
    if (['events-only','timeline-read-only','lyrics-only','http-only'].includes(mode)) {
      const before = { ...reads };
      listeners.get('songChange')({ detail: { ncmId: 8, songName: 'next' } });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(reads.metadata - before.metadata, 0);
      assert.equal(reads.timeline - before.timeline, mode === 'timeline-read-only' ? 1 : 0);
      if (mode !== 'lyrics-only') assert.equal(calls.length, 0);
    }
  }
});
