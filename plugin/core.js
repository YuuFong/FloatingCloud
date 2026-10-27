/* FloatingCloud Lite — lyric parsing, playback-clock and render timing primitives.
 * Original implementation. Behaviors informed by ANYNC TaskbarLyrics v1.7.4 (MIT).
 * No source fonts or third-party renderer code included.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FloatingCloudCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const FONT_OPTIONS = Object.freeze([
    { value: 'Microsoft YaHei, sans-serif', label: '微软雅黑' },
    { value: '"Source Han Sans SC", "Source Han Sans CN", "思源黑体 CN", "Noto Sans CJK SC", "思源黑体", "Microsoft YaHei", sans-serif', label: '思源黑体（需本机安装）' },
    { value: '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif', label: 'Noto Sans CJK SC' },
    { value: '"Segoe UI", "Microsoft YaHei", sans-serif', label: 'Segoe UI' },
    { value: '"SimSun", serif', label: '宋体' }
  ]);
  const WEIGHT_OPTIONS = Object.freeze([
    { value: 300, label: '细体 · Light (300)' },
    { value: 400, label: '常规 · Regular (400)' },
    { value: 500, label: '中等 · Medium (500)' },
    { value: 600, label: '半粗 · SemiBold (600)' },
    { value: 700, label: '粗体 · Bold (700)' }
  ]);
  const DEFAULTS = Object.freeze({
    enabled: true,
    font: 'Microsoft YaHei, sans-serif',
    fontWeight: 600, fontSize: 30,
    nextFontSize: 23, color: '#d4d9e5', nextColor: '#a8b2c8',
    highlight: '#ffffff', strokeWidth: 1.4, strokeColor: '#222936',
    shadow: 3, lineGap: 12, align: 'center', width: 740,
    offsetMs: 0, animationSpeed: 1, showTranslation: true,
    enableWordScan: true
  });
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const number = (v, def) => (v !== null && v !== '' && Number.isFinite(Number(v))) ? Number(v) : def;
  const color = (x, fallback) => /^#[0-9a-f]{6}$/i.test(String(x)) ? String(x) : fallback;
  function normalizeSettings(input) {
    const v = Object.assign({}, DEFAULTS, input && typeof input === 'object' ? input : {});
    const validFonts = FONT_OPTIONS.map(f => f.value);
    const font = validFonts.includes(v.font) ? v.font : DEFAULTS.font;
    const weights = WEIGHT_OPTIONS.map(w => w.value);
    const fontWeight = weights.includes(number(v.fontWeight, DEFAULTS.fontWeight)) ? Number(v.fontWeight) : DEFAULTS.fontWeight;
    return {
      enabled: Boolean(v.enabled), font, fontWeight,
      fontSize: clamp(number(v.fontSize, 30), 14, 64),
      nextFontSize: clamp(number(v.nextFontSize, 23), 12, 56),
      color: color(v.color, DEFAULTS.color),
      nextColor: color(v.nextColor, DEFAULTS.nextColor),
      highlight: color(v.highlight, DEFAULTS.highlight),
      strokeWidth: clamp(number(v.strokeWidth, 1.4), 0, 5),
      strokeColor: color(v.strokeColor, DEFAULTS.strokeColor),
      shadow: clamp(number(v.shadow, 3), 0, 16),
      lineGap: clamp(number(v.lineGap, 12), 0, 40),
      align: ['left', 'center', 'right'].includes(v.align) ? v.align : 'center',
      width: clamp(number(v.width, 740), 300, 1200),
      offsetMs: clamp(number(v.offsetMs, 0), -5000, 5000),
      animationSpeed: clamp(number(v.animationSpeed, 1), .5, 2),
      showTranslation: Boolean(v.showTranslation),
      enableWordScan: Boolean(v.enableWordScan)
    };
  }
  const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  function parseLrc(input) {
    if (typeof input !== 'string') return [];
    const lines = [];
    for (const raw of input.replace(/\r/g, '').split('\n')) {
      timestampPattern.lastIndex = 0;
      const stamps = [...raw.matchAll(timestampPattern)];
      if (!stamps.length) continue;
      const text = raw.replace(timestampPattern, '').trim();
      if (!text) continue;
      for (const match of stamps) {
        const fraction = (match[3] || '0').padEnd(3, '0').slice(0, 3);
        const time = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(fraction);
        lines.push({ time, text, words: [], kind: 'lrc' });
      }
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  // YRC line format: [absolute start, duration](relative word start, word duration, 0)word...
  function parseYrc(input) {
    if (typeof input !== 'string') return [];
    const lines = [];
    const tokenPattern = /\((\d+),(\d+),(\d+)\)([^()]*?)(?=\(\d+,\d+,\d+\)|$)/g;
    for (const raw of input.replace(/\r/g, '').split('\n')) {
      const trimmed = raw.trim();
      const match = /^\[(\d+),(\d+)\]/.exec(trimmed);
      if (!match) continue;
      const time = Number(match[1]);
      const duration = Number(match[2]);
      if (!Number.isSafeInteger(time) || !Number.isSafeInteger(duration)) continue;
      const body = trimmed.slice(match[0].length);
      const words = [];
      for (const token of body.matchAll(tokenPattern)) {
        const text = token[4];
        if (!text) continue;
        words.push({ text, start: time + Number(token[1]), duration: Number(token[2]) });
      }
      if (!words.length) continue;
      const text = words.map(w => w.text).join('').trim();
      if (text) lines.push({ time, duration, text, words, kind: 'yrc' });
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  function attachTranslations(lines, translatedLrc) {
    const translations = parseLrc(translatedLrc);
    if (!translations.length) return lines;
    return lines.map(line => {
      let nearest = null;
      let distance = Infinity;
      // Most lyrics have matching starts, allow 400ms clock skew.
      for (const tr of translations) {
        const delta = Math.abs(tr.time - line.time);
        if (delta < distance) { nearest = tr; distance = delta; }
      }
      return { ...line, translation: nearest && distance <= 400 ? nearest.text : '' };
    });
  }
  function parseNcmLyrics(data) {
    const yrc = parseYrc(data?.yrc?.lyric || '');
    const kind = yrc.length ? 'yrc' : 'lrc';
    const originals = yrc.length ? yrc : parseLrc(data?.lrc?.lyric || '');
    // YRC translations have their own timestamps; prefer them only for YRC.
    const primaryTranslation = kind === 'yrc' ? (data?.ytlrc?.lyric || '') : (data?.tlyric?.lyric || '');
    const fallbackTranslation = kind === 'yrc' ? (data?.tlyric?.lyric || '') : (data?.ytlrc?.lyric || '');
    let lines = attachTranslations(originals, primaryTranslation);
    if (!lines.some(line => line.translation) && fallbackTranslation) lines = attachTranslations(originals, fallbackTranslation);
    return { lines, kind };
  }
  function resolveIndex(lines, timeMs) {
    if (!lines.length) return -1;
    let left = 0, right = lines.length - 1, best = -1;
    while (left <= right) {
      const mid = (left + right) >> 1;
      if (lines[mid].time <= timeMs) { best = mid; left = mid + 1; }
      else right = mid - 1;
    }
    return best;
  }
  function lineProgress(lines, index, timeMs) {
    if (index < 0 || index >= lines.length) return 0;
    const line = lines[index];
    const next = lines[index + 1];
    const until = (line.duration > 0) ? (line.time + line.duration) : (next?.time ?? line.time + 4500);
    const end = next ? Math.min(until, next.time) : until;
    return clamp((timeMs - line.time) / Math.max(1, end - line.time), 0, 1);
  }
  function wordProgress(word, timeMs) {
    if (!word || !Number.isFinite(word.start)) return 0;
    if (timeMs < word.start) return 0;
    if (!word.duration || word.duration < 1) return 1;
    return clamp((timeMs - word.start) / word.duration, 0, 1);
  }
  // For summary indicators only; rendering uses each YRC token's own progress.
  function lyricProgress(lines, index, timeMs) {
    if (index < 0 || index >= lines.length) return 0;
    const words = lines[index].words || [];
    if (!words.length) return lineProgress(lines, index, timeMs);
    const weight = w => Math.max(Array.from(w.text).length, 1);
    const total = words.reduce((sum, w) => sum + weight(w), 0);
    return clamp(words.reduce((sum, w) => sum + weight(w) * wordProgress(w, timeMs), 0) / Math.max(total, 1), 0, 1);
  }
  function createClock(now = () => performance.now()) {
    let basePosition = 0, baseStamp = now(), playing = false;
    return {
      anchor(positionMs, isPlaying = playing) {
        const incoming = Math.max(0, number(positionMs, 0));
        const latest = this.position();
        // Small jitter should not make scan step backwards, large seek must win.
        basePosition = isPlaying && playing && Math.abs(incoming - latest) < 180
          ? Math.max(incoming, latest) : incoming;
        baseStamp = now(); playing = Boolean(isPlaying);
      },
      setPlaying(value) {
        basePosition = this.position(); baseStamp = now(); playing = Boolean(value);
      },
      isPlaying() { return playing; },
      position() { return Math.max(0, basePosition + (playing ? now() - baseStamp : 0)); },
      reset() { basePosition = 0; baseStamp = now(); playing = false; }
    };
  }
  return { DEFAULTS, FONT_OPTIONS, WEIGHT_OPTIONS, normalizeSettings, parseLrc, parseYrc,
    attachTranslations, parseNcmLyrics, resolveIndex, lineProgress, wordProgress, lyricProgress, createClock };
});
