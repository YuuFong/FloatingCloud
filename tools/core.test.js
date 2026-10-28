const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../plugin/core.js');

test('LRC multi-timestamp parsing and fractional precision', () => {
  const r = C.parseLrc('[00:01.50][00:02.123]hello\n[00:03.000]world');
  assert.deepEqual(r.map(x => x.time), [1500, 2123, 3000]);
  assert.equal(r[0].kind, 'lrc');
});
test('YRC tokens retain absolute timestamps and whitespace', () => {
  const r = C.parseYrc('[1000,2400](0,1000,0)hello (1000,1400,0)world');
  assert.equal(r[0].kind, 'yrc');
  assert.equal(r[0].words[1].start, 2000);
  assert.equal(r[0].text, 'hello world');
});
test('YRC word progress respects actual timing gaps and pauses', () => {
  const l = C.parseYrc('[1000,3100](0,1000,0)你(1500,1000,0)好');
  assert.equal(C.wordProgress(l[0].words[0], 1000), 0);
  assert.equal(C.wordProgress(l[0].words[0], 1500), .5);
  assert.equal(C.wordProgress(l[0].words[0], 2250), 1);
  assert.equal(C.wordProgress(l[0].words[1], 2250), 0);
  assert.equal(C.wordProgress(l[0].words[1], 3000), .5);
  assert.equal(C.lyricProgress(l, 0, 3000), .75);
});
test('NCM lyrics prefer YRC+YTLRC; fall back to LRC+TLYRIC', () => {
  const data = {
    yrc:{lyric:'[1000,2000](0,900,0)你(900,1100,0)好'},
    lrc:{lyric:'[00:01.000]hello'},
    ytlrc:{lyric:'[00:01.000]hello translated'},
    tlyric:{lyric:'[00:01.000]legacy translated'}
  };
  const y=C.parseNcmLyrics(data);
  assert.equal(y.kind, 'yrc'); assert.equal(y.lines[0].translation, 'hello translated');
  delete data.yrc;
  const l=C.parseNcmLyrics(data);
  assert.equal(l.kind, 'lrc'); assert.equal(l.lines[0].translation, 'legacy translated');
});
test('translation timing matching tolerates small skew but not unrelated lines', () => {
  const a=C.parseLrc('[00:01.000]line1\n[00:04.000]line2');
  const b=C.attachTranslations(a,'[00:01.250]译文\n[00:05.000]超时');
  assert.equal(b[0].translation,'译文'); assert.equal(b[1].translation,'');
});
test('lookup correctly handles before first, exact and after last', () => {
  const lines = C.parseLrc('[00:01.00]a\n[00:04.00]b');
  assert.equal(C.resolveIndex(lines, 990), -1);
  assert.equal(C.resolveIndex(lines, 1000), 0);
  assert.equal(C.resolveIndex(lines, 4500), 1);
});
test('LRC scans using line duration, last line fallback', () => {
  const l=C.parseLrc('[00:01.000]a\n[00:03.000]b');
  assert.equal(C.lineProgress(l,0,2000),.5);
  assert.equal(C.lineProgress(l,1,5250),.5);
});
test('clock freezes at pause and handles backward seek', () => {
  let t=0; const c=C.createClock(()=>t);
  c.anchor(5000,true);t=300;
  assert.equal(c.position(),5300);
  c.setPlaying(false);t=900;
  assert.equal(c.position(),5300);
  c.anchor(1200,false);
  assert.equal(c.position(),1200);
  c.setPlaying(true); t=1200;
  assert.equal(c.position(),1500);
});
test('settings migrate older values and recognize font weights', () => {
  const existing=C.normalizeSettings({font:'Microsoft YaHei, sans-serif',fontSize:35,offsetMs:700});
  assert.equal(existing.fontWeight,600);assert.equal(existing.fontSize,35);
  assert.equal(existing.offsetMs,700);
  const withNew=C.normalizeSettings({font:C.FONT_OPTIONS[1].value,fontWeight:300});
  assert.equal(withNew.font,C.FONT_OPTIONS[1].value);
  assert.equal(withNew.fontWeight,300);
  assert.equal(C.normalizeSettings({fontWeight:1234}).fontWeight,600);
});
test('invalid config values are clamped and color rejects arbitrary CSS', () => {
  const s=C.normalizeSettings({fontSize:999,width:-1,color:'red',animationSpeed:0});
  assert.equal(s.fontSize,64);assert.equal(s.width,300);
  assert.equal(s.color,C.DEFAULTS.color);assert.equal(s.animationSpeed,.5);
});

test('two lyric rows always share one font size after old config migration',()=>{
 const normalized=C.normalizeSettings({fontSize:34,nextFontSize:18,showTranslation:true});
 assert.equal(normalized.fontSize,34);
 assert.equal(Object.hasOwn(normalized,'nextFontSize'),false);
 assert.equal(normalized.showTranslation,true);
 assert.equal(C.normalizeSettings({showTranslation:false}).showTranslation,false);
});
test('Lyricsfile word timestamps use absolute milliseconds',()=>{
 const yaml=[
 "version: '1.0'",
 "lines:",
 "  - text: 'Hello world'",
 "    start_ms: 12000",
 "    end_ms: 15000",
 "    words:",
 "      - text: 'Hello '",
 "        start_ms: 12000",
 "        end_ms: 12500",
 "      - text: 'world'",
 "        start_ms: 12500",
 "        end_ms: 14500",
 "plain: |",
 "  Hello world",
 ].join('\n');
 const lines=C.parseLyricsfile(yaml);
 assert.equal(lines.length,1);assert.equal(lines[0].words.length,2);
 assert.equal(lines[0].words[1].start,12500);
 assert.equal(C.wordProgress(lines[0].words[1],13500),.5);
 const record={trackName:'Hello!',artistName:'Someone',duration:120,hasWordSync:true,lyricsfile:yaml};
 const matched=C.parseLrclibRecord(record,{title:'Hello',artist:'Someone',durationMs:120000});
 assert.equal(matched.kind,'lyricsfile');
 assert.equal(C.parseLrclibRecord(record,{title:'Different',artist:'Someone'}),null);
 assert.equal(C.parseLrclibRecord(record,{title:'Hello',artist:'Someone',durationMs:130000}),null);
});
test('LRCLIB plain synced lines downgrade to LRC, never fabricate word timings',()=>{
 const rec={trackName:'song',artistName:'artist',duration:180,hasWordSync:false,
   syncedLyrics:'[00:01.000]first\n[00:04.000]second'};
 const parsed=C.parseLrclibRecord(rec,{title:'Song',artist:'Artist',durationMs:180000});
 assert.equal(parsed.kind,'lrc');
 assert.equal(parsed.lines[0].words.length,0);
});

test('TaskbarLyrics-style continuous word scan respects timed syllables',()=>{
 const [line]=C.parseYrc('[1000,3000](0,1000,0)hello (1500,1000,0)world');
 assert.equal(C.wordScanProgress(line,1000),0);
 assert.ok(Math.abs(C.wordScanProgress(line,1500)-(3/11))<1e-5);
 assert.ok(Math.abs(C.wordScanProgress(line,2250)-(6/11))<1e-5);
 assert.ok(Math.abs(C.wordScanProgress(line,3000)-(8.5/11))<1e-5);
 assert.equal(C.wordScanProgress(line,4000),1);
});

test('Lyricsfile missing word end_ms derives next start or line end',()=>{
  const yaml=[
    'version: "1.0"',
    'lines:',
    '  - text: "This was a triumph."',
    '    words:',
    '      - text: "This "',
    '        start_ms: 290',
    '      - text: "was "',
    '        start_ms: 536',
    '      - text: "a "',
    '        start_ms: 784',
    '      - text: "triumph."',
    '        start_ms: 923',
    '    start_ms: 290',
    '    end_ms: 3840',
    'plain: |',
    '  This was a triumph.'
  ].join('\n');
  const parsed=C.parseLyricsfile(yaml);
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].words.length,4);
  assert.equal(parsed[0].words[0].duration,246);
  assert.equal(parsed[0].words[2].duration,139);
  assert.equal(parsed[0].words[3].duration,2917);
  assert.ok(C.wordScanProgress(parsed[0],1000)>0);
});

test('local lyric lookup mode migration and path settings',()=>{
  const defaults=C.normalizeSettings({});
  assert.equal(defaults.lyricsMode,'online-first');
  assert.equal(defaults.localLyricsFolders,'');
  const local=C.normalizeSettings({lyricsMode:'local-only',
    localLyricsFolders:'D:\\Music;E:\\Songs'});
  assert.equal(local.lyricsMode,'local-only');
  assert.equal(local.localLyricsFolders,'D:\\Music;E:\\Songs');
  assert.equal(C.normalizeSettings({lyricsMode:'invalid'}).lyricsMode,'online-first');
  assert.equal(C.normalizeSettings({lyricsMode:'local-first'}).lyricsMode,'local-first');
  assert.ok(C.normalizeSettings({localLyricsFolders:'a'.repeat(6000)}).localLyricsFolders.length<=2048);
});

test('spectrum spacing is persistent, numeric and clamped for 32-bar layout',()=>{
 assert.equal(C.normalizeSettings({}).spectrumGap,3);
 assert.equal(C.normalizeSettings({spectrumGap:7}).spectrumGap,7);
 assert.equal(C.normalizeSettings({spectrumGap:-20}).spectrumGap,0);
 assert.equal(C.normalizeSettings({spectrumGap:999}).spectrumGap,14);
 assert.equal(C.normalizeSettings({spectrumGap:'n/a'}).spectrumGap,3);
});

test('TaskbarLyrics foreground hierarchy uses a single base and consistent alpha',()=>{
 const p=C.lyricPalette('light',false);
 assert.equal(p.primary,'rgba(255,255,255,0.9)');
 assert.equal(p.translation,'rgba(255,255,255,0.7)');
 assert.equal(p.secondary,'rgba(255,255,255,0.6)');
 assert.equal(C.lyricPalette('dark',false).translation,'rgba(17,24,39,0.7)');
 assert.equal(C.lyricPalette('system',true).primary,'rgba(17,24,39,0.9)');
 assert.equal(C.lyricPalette('system',false).primary,'rgba(255,255,255,0.9)');
});
test('legacy separate colors are ignored while foreground mode is kept',()=>{
 const old=C.normalizeSettings({
   color:'#123456',nextColor:'#abcdef',highlight:'#ff0000',strokeColor:'#00ff00'
 });
 assert.equal(old.foregroundMode,'system');
 assert.ok(!Object.hasOwn(old,'color'));
 assert.ok(!Object.hasOwn(old,'nextColor'));
 assert.ok(!Object.hasOwn(old,'highlight'));
 assert.ok(!Object.hasOwn(old,'strokeColor'));
 assert.equal(C.normalizeSettings({foregroundMode:'dark'}).foregroundMode,'dark');
 assert.equal(C.normalizeSettings({foregroundMode:'custom'}).foregroundMode,'system');
});

test('instrumental placeholder lyrics trigger spectrum without false positive ordinary singing',()=>{
 const silent=[{time:0,text:'纯音乐，请欣赏',kind:'lrc'}];
 assert.equal(C.isInstrumentalPlaceholder(silent[0]),true);
 assert.equal(C.isInstrumentalPlaceholder({text:'  纯音乐，请欣赏！  '}),true);
 assert.equal(C.isInstrumentalPlaceholder({text:'Instrumental Version'}),true);
 assert.equal(C.shouldDisplaySpectrum(silent,false,false,'auto'),true);
 assert.equal(C.shouldDisplaySpectrum([],false,false,'auto'),true);
 assert.equal(C.shouldDisplaySpectrum([],true,true,'auto'),false);
 assert.equal(C.shouldDisplaySpectrum([{text:'今天的纯音乐真好听'}],false,false,'auto'),false);
 assert.equal(C.shouldDisplaySpectrum([{text:'普通歌词'}],true,false,'auto'),true);
 assert.equal(C.shouldDisplaySpectrum([{text:'普通歌词'}],false,false,'force-spectrum'),true);
 assert.equal(C.shouldDisplaySpectrum([],true,false,'lyrics-only'),false);
});
test('spectrum display mode is validated independently of spacing setting',()=>{
 assert.equal(C.normalizeSettings({}).spectrumMode,'auto');
 assert.equal(C.normalizeSettings({spectrumMode:'force-spectrum'}).spectrumMode,'force-spectrum');
 assert.equal(C.normalizeSettings({spectrumMode:'lyrics-only'}).spectrumMode,'lyrics-only');
 assert.equal(C.normalizeSettings({spectrumMode:'invalid'}).spectrumMode,'auto');
});
