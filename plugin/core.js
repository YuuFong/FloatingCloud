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
    foregroundMode: 'system', strokeWidth: 1.4,
    shadow: 3, lineGap: 12, align: 'center', width: 740,
    spectrumGap: 3, spectrumBarWidth: 3,
    spectrumMode: 'auto',
    offsetMs: 0, animationSpeed: 1, showTranslation: false,
    enableWordScan: true,
    chorusGlowEnabled: false, chorusGlowIntensity: 30, chorusGlowStyle: 'soft',
    lyricsMode: 'online-first',
    localLyricsFolders: ''
  });
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const number = (v, def) => (v !== null && v !== '' && Number.isFinite(Number(v))) ? Number(v) : def;
  // TaskbarLyrics v1.7.4 ForegroundColorPolicy: one foreground base,
  // primary 90%, translation 70%, secondary 60% alpha.
  function lyricPalette(mode, systemUsesLightTheme = false) {
    const darkText = mode === 'dark' || (mode === 'system' && systemUsesLightTheme);
    const rgb = darkText ? '17,24,39' : '255,255,255';
    return {
      primary: `rgba(${rgb},0.9)`,
      translation: `rgba(${rgb},0.7)`,
      secondary: `rgba(${rgb},0.6)`,
      // TBL's 190/255 overlay was too dim on some desktop backgrounds;
      // this conservative render path favors contrast and stable playback.
      // Playback hotfix: the played portion needs a visibly stronger layer.
      // Use a plain fully opaque clip overlay, avoiding GPU mask composition.
      scan: `rgba(${rgb},1)`,
      stroke: darkText ? '#f8fafc' : '#222936',
      spectrum: darkText ? '#111827' : '#ffffff'
    };
  }
  function normalizeSettings(input) {
    const v = Object.assign({}, DEFAULTS, input && typeof input === 'object' ? input : {});
    const validFonts = FONT_OPTIONS.map(f => f.value);
    const font = validFonts.includes(v.font) ? v.font : DEFAULTS.font;
    const weights = WEIGHT_OPTIONS.map(w => w.value);
    const fontWeight = weights.includes(number(v.fontWeight, DEFAULTS.fontWeight)) ? Number(v.fontWeight) : DEFAULTS.fontWeight;
    return {
      enabled: Boolean(v.enabled), font, fontWeight,
      fontSize: clamp(number(v.fontSize, 30), 14, 64),
      foregroundMode: ['system','light','dark'].includes(v.foregroundMode)
        ? v.foregroundMode : 'system',
      strokeWidth: clamp(number(v.strokeWidth, 1.4), 0, 5),
      shadow: clamp(number(v.shadow, 3), 0, 16),
      lineGap: clamp(number(v.lineGap, 12), 0, 40),
      spectrumGap: clamp(number(v.spectrumGap, 3), 0, 14),
      spectrumBarWidth: clamp(number(v.spectrumBarWidth, 3), 1, 12),
      spectrumMode: ['auto','force-spectrum','lyrics-only'].includes(v.spectrumMode)
        ? v.spectrumMode : 'auto',
      align: ['left', 'center', 'right'].includes(v.align) ? v.align : 'center',
      width: clamp(number(v.width, 740), 300, 1200),
      offsetMs: clamp(number(v.offsetMs, 0), -5000, 5000),
      animationSpeed: clamp(number(v.animationSpeed, 1), .5, 2),
      showTranslation: Boolean(v.showTranslation), // original + translation when provided
      enableWordScan: Boolean(v.enableWordScan),
      chorusGlowEnabled: Boolean(v.chorusGlowEnabled),
      chorusGlowIntensity: clamp(number(v.chorusGlowIntensity, 30), 0, 100),
      chorusGlowStyle: ['soft','standard'].includes(v.chorusGlowStyle)
        ? v.chorusGlowStyle : 'standard',
      lyricsMode: ['online-first','local-first','local-only'].includes(v.lyricsMode)
        ? v.lyricsMode : 'online-first',
      // Paths are saved only in BetterNCM settings and sent to the local .NET helper.
      localLyricsFolders: String(v.localLyricsFolders||'').slice(0,2048)
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
  // LRCLIB Lyricsfile v1 draft: strict subset of line/word mappings.
  // Never interpret arbitrary YAML tags, anchors or application code.
  function parseLyricsfile(input) {
    if (typeof input !== 'string' || input.length > 256000) return [];
    const out = []; let inLines = false, inWords = false, current = null, word = null;
    const val = v => {
      v = v.trim();
      if (v.startsWith("'") && v.endsWith("'")) return v.slice(1,-1).replace(/''/g,"'");
      if (v.startsWith('"') && v.endsWith('"')) {
        try { return JSON.parse(v); } catch (_) { return v.slice(1,-1); }
      }
      return v.replace(/\s+#.*$/,'');
    };
    for (const raw of input.split(/\r?\n/)) {
      if (/^lines:\s*(?:#.*)?$/.test(raw)) { inLines = true; continue; }
      if (!inLines) continue;
      if (/^\S/.test(raw) && !/^lines:/.test(raw)) break;
      let m;
      if ((m = /^  - text:\s*(.*)$/.exec(raw))) {
        current = { text: val(m[1]), time: NaN, duration: 0, words: [], kind: 'lyricsfile' };
        out.push(current); inWords = false; word = null;
      } else if (current && (m = /^    (start_ms|end_ms|text):\s*(.*)$/.exec(raw))) {
        if (m[1] === 'text') current.text = val(m[2]);
        else if (m[1] === 'start_ms') current.time = Number(m[2]);
        else current.end = Number(m[2]);
      } else if (current && /^\s{4}words:\s*$/.test(raw)) {inWords = true;}
      else if (inWords && current && (m = /^\s{6}- text:\s*(.*)$/.exec(raw))) {
        word = { text: val(m[1]), start: NaN, duration: 0 };
        current.words.push(word);
      } else if (word && (m = /^\s{8}(start_ms|end_ms|text):\s*(.*)$/.exec(raw))) {
        if (m[1] === 'text') word.text = val(m[2]);
        else if (m[1] === 'start_ms') word.start = Number(m[2]);
        else word.end = Number(m[2]);
      }
    }
    return out.filter(line => {
      if (!Number.isSafeInteger(line.time) || line.time < 0 || !line.text) return false;
      line.duration = Number.isFinite(line.end) ? Math.max(0, line.end-line.time) : 0;
      line.words = line.words.filter(w => Number.isSafeInteger(w.start) && w.start >= 0);
      for (let i = 0; i < line.words.length; i++) {
        const w=line.words[i], next=line.words[i+1];
        // Lyricsfile permits word start_ms without end_ms. Infer the end from
        // the following word start, or the containing line's end_ms.
        const until=Number.isFinite(w.end) ? w.end :
          (next?.start ?? (Number.isFinite(line.end) ? line.end : w.start));
        w.duration=Math.max(0,until-w.start);
      }
      if (line.words.map(w => w.text).join('').trim() !== line.text.trim()) line.words = [];
      return true;
    }).sort((a,b)=>a.time-b.time);
  }
  function normalizedSong(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[’‘“”"'·•.，,\/\\()（）[\]【】\-–—_!！?？:：]/g,'')
      .replace(/\s+/g,'');
  }
  function parseLrclibRecord(record, metadata) {
    if (!record || record.instrumental) return null;
    const title=normalizedSong(metadata?.title);
    const artist=normalizedSong(metadata?.artist);
    if (!title || !artist || normalizedSong(record.trackName) !== title) return null;
    const officialArtist = normalizedSong(record.artistName);
    if (!officialArtist || !(officialArtist.includes(artist) || artist.includes(officialArtist))) return null;
    const durationMs=Number(metadata?.durationMs||0);
    if (durationMs > 0 && Number.isFinite(record.duration) &&
        Math.abs(record.duration*1000-durationMs) > 5000) return null;
    const wordLines=record.hasWordSync ? parseLyricsfile(record.lyricsfile) : [];
    if (wordLines.some(l=>l.words.length)) return {lines:wordLines,kind:'lyricsfile',provider:'LRCLIB'};
    const lines=parseLrc(record.syncedLyrics || '');
    return lines.length ? {lines,kind:'lrc',provider:'LRCLIB'} : null;
  }

  // Music-service instrumental records frequently include technical credits
  // preceding "纯音乐，请欣赏" (composer/arranger, etc.). They are not sung
  // lyrics. Detect the WHOLE record, not only exact one-line placeholders.
  function normalizeNonLyric(text) {
    return String(text || '').normalize('NFKC').toLowerCase().trim()
      .replace(/[\s,，。！!~～:：·•.()（）\[\]【】_\-–—]/g,'');
  }
  function isInstrumentalPlaceholder(line) {
    const t = normalizeNonLyric(line?.text);
    return /^(?:纯音乐|纯音乐请欣赏|纯音乐敬请欣赏|该歌曲为纯音乐|此歌曲为纯音乐|本歌曲为纯音乐|该歌曲为纯音乐请欣赏|此歌曲为纯音乐请欣赏|此歌曲为伴奏|伴奏|无歌词|暂无歌词|暂未收录歌词|暂无相关歌词|instrumental|instrumentalversion|musiconly|nolyrics|nolyricsavailable)$/.test(t);
  }
  function isLyricCredit(line) {
    const t=String(line?.text||'').normalize('NFKC').trim();
    return /^(?:作曲|作词|编曲|制作人|演奏|演唱|混音|录音|母带|监制|出品|发行|音乐制作|键盘|吉他|钢琴|鼓|贝斯|小提琴|长笛|编制|composer|arranger|producer|performed by|mixed by|mastered by|written by)\s*[:：]\s*\S.{0,180}$/i.test(t);
  }
  function isInstrumentalRecord(lines) {
    if(!Array.isArray(lines)||!lines.length||lines.length>24)return false;
    // A couple credit lines plus the generic instrumental placeholder should
    // not suppress spectrum. Without that explicit placeholder or NCM song
    // metadata, credits alone are insufficient evidence of instrumentality.
    const meaningful=lines.filter(l=>String(l?.text||'').trim());
    return meaningful.length>0 &&
      meaningful.some(isInstrumentalPlaceholder) &&
      meaningful.every(l=>isInstrumentalPlaceholder(l)||isLyricCredit(l));
  }
  function isNcmInstrumental(song) {
    if(!song || typeof song !== 'object')return false;
    if(song.nolyric === true || song.noLyric === true || song.instrumental === true ||
       song.isPureMusic === true)return true;
    // NetEase song detail "mark" has an instrumental flag (bit 17).
    // Read as a nonnegative safe integer, never coerce absent fields to zero.
    const mark=Number(song.mark);
    return Number.isSafeInteger(mark) && mark>0 && (Math.floor(mark/131072)%2===1);
  }
  function shouldDisplaySpectrum(lines, pureMusic=false, searching=false, mode='auto', trackInstrumental=false) {
    if(mode==='lyrics-only')return false;
    if(mode==='force-spectrum')return true;
    if(searching)return false;
    if(pureMusic || trackInstrumental)return true;
    if(!Array.isArray(lines)||lines.length===0)return true;
    return isInstrumentalRecord(lines);
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
  // Match TBL's substring cursor and complete the line after the last
  // syllable, even when punctuation or unmatched text follows it.
  function wordScanProgress(line, timeMs) {
    if (!line?.text || !Array.isArray(line.words) || !line.words.length) return null;
    const text=line.text, length=text.length;
    let readCursor=0, scanned=0, usable=false, lastEnd=0;
    for (const w of line.words) {
      if (!w?.text || !Number.isFinite(w.start)) continue;
      let offset=text.indexOf(w.text,readCursor);
      if(offset<0) offset=Math.min(readCursor,length);
      const width=Math.min(w.text.length,length-offset);
      if(width<=0) continue;
      usable=true;
      lastEnd=w.start+Math.max(0,Number(w.duration)||0);
      if(timeMs<=w.start) break;
      const progress=w.duration>0?clamp((timeMs-w.start)/w.duration,0,1):1;
      scanned=offset+width*progress;
      if(progress<1) break;
      readCursor=offset+width;
    }
    if(!usable)return null;
    if(scanned>=readCursor && readCursor>0 && timeMs>=lastEnd)return 1;
    return clamp(scanned/Math.max(1,length),0,1);
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
  function normalizeChorusIntervals(input, durationMs) {
    if (!Array.isArray(input) || !Number.isFinite(durationMs) || durationMs <= 0) return [];
    return input.slice(0, 12).filter(segment => {
      const start = Number(segment?.startMs), end = Number(segment?.endMs);
      return Number.isFinite(start) && Number.isFinite(end) && start >= 0 &&
        end > start && end - start >= 1000 && end - start <= 120000 &&
        end <= durationMs + 1000;
    }).map(segment => ({startMs:Number(segment.startMs), endMs:Number(segment.endMs)}))
      .sort((a,b) => a.startMs - b.startMs);
  }
  function isChorusActive(intervals, positionMs) {
    return Number.isFinite(positionMs) && Array.isArray(intervals) &&
      intervals.some(segment => positionMs >= segment.startMs && positionMs < segment.endMs);
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
  return { DEFAULTS, FONT_OPTIONS, WEIGHT_OPTIONS, normalizeSettings, lyricPalette, parseLrc, parseYrc,
    attachTranslations, parseNcmLyrics, parseLyricsfile, parseLrclibRecord,
    isInstrumentalPlaceholder, isLyricCredit, isInstrumentalRecord, isNcmInstrumental, shouldDisplaySpectrum, resolveIndex, lineProgress, wordProgress, wordScanProgress, lyricProgress, normalizeChorusIntervals, isChorusActive, createClock };
});
