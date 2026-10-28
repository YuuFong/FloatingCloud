/* FloatingCloud Lite — BetterNCM settings + lyric preview, no native HWND takeover.
 * Animations reimplemented with TaskbarLyrics v1.7.4 timing values.
 */
(() => {
  'use strict';
  if (typeof plugin === 'undefined' || !window.FloatingCloudCore) return;
  const Core = window.FloatingCloudCore;
  const VERSION = '0.4.22-beta';
  const DIAG_KEY = 'diagnostic-mode-v1';
  const DIAG_MODES = ['full','no-preview','no-spectrum','no-window','no-native-lyrics','events-only','inert',
    'timeline-read-only','lyrics-only','http-only'];
  const selectedMode = plugin.getConfig(DIAG_KEY, 'full');
  const diagMode = DIAG_MODES.includes(selectedMode) ? selectedMode : 'full';
  const diag = {
    preview: !['no-preview','events-only','inert','timeline-read-only','lyrics-only','http-only'].includes(diagMode),
    spectrum: diagMode !== 'no-spectrum',
    window: !['no-window','events-only','inert','timeline-read-only','lyrics-only','http-only'].includes(diagMode),
    nativeLyrics: !['no-native-lyrics','http-only'].includes(diagMode),
    trackTimeline: !['events-only','lyrics-only','http-only'].includes(diagMode),
    lyricRequests: !['events-only','timeline-read-only'].includes(diagMode),
    events: diagMode !== 'inert'
  };
  console.info('[FloatingCloud diagnostic] mode=' + diagMode);
  const NcmPath = window.FloatingCloudNcmPath;
  const KEY = 'appearance-v2' /* keep existing users’ saved settings */;
  const DEMO = Core.parseNcmLyrics({
    yrc: { lyric: [
      '[0,3200](0,600,0)窗外(600,500,0)的风(1100,750,0)缓缓(1850,950,0)吹过',
      '[3500,3200](0,500,0)把日常(500,750,0)写成(1250,850,0)一首歌',
      '[7000,3200](0,500,0)听见(500,650,0)时间(1150,850,0)轻轻(2000,850,0)流动',
      '[10500,3200](0,650,0)在微光里(650,700,0)继续(1350,850,0)向前'
    ].join('\n') },
    ytlrc: { lyric: [
      '[00:00.000]A breeze drifts past the window',
      '[00:03.500]Turning ordinary days into a song',
      '[00:07.000]Hearing time flow quietly',
      '[00:10.500]Moving forward in the gentle light'
    ].join('\n') }
  }).lines;
  let settings = Core.normalizeSettings(plugin.getConfig(KEY, {}));
  let live = null;
  let desktop = null;
  const subscribers = new Set();
  const notify = () => subscribers.forEach(fn => { try { fn(); } catch (e) { console.warn('[FloatingCloud] view update', e); } });
  const setSettings = (patch) => {
    const previousMode=settings.lyricsMode, previousFolders=settings.localLyricsFolders;
    settings = Core.normalizeSettings({ ...settings, ...patch });
    plugin.setConfig(KEY, settings);
    notify();
    // A future native window host may subscribe to these settings explicitly.
    try { desktop?.applySettings(settings); } catch (e) { console.warn(e); }
    if(previousMode!==settings.lyricsMode ||
       previousFolders!==settings.localLyricsFolders) live?.refresh();
  };

  class LiveLyrics {
    constructor() {
      this.api = null; this.trackKey = ''; this.title = '';
      this.lines = []; this.kind = ''; this.error = ''; this.busy = false; this.pureMusic=false;
      this.trackInstrumental=false;this.instrumentalHint='';
      this.clock = Core.createClock(); this.listeners = [];
      this.cancel = null; this.retry = null; this.attempts = 0;
      this.cache = new Map();
      this.generation = 0; this.pendingSong = null; this.songTask = null;
    }
    init() {
      const attach = () => {
        const api = window.InfLinkApi;
        if (api && typeof api.getCurrentSong === 'function' && typeof api.addEventListener === 'function') {
          clearInterval(this.retry); this.retry = null; this.api = api;
          // InfLink dispatches on the NCM renderer. Never call back into NCM or
          // the native bridge while its song-change dispatch is on the stack.
          this.attach('songChange', e => this.queueTrack(e?.detail));
          this.attach('timelineUpdate', e => {
            const p = e?.detail;
            if (Number.isFinite(p?.currentTime)) this.clock.anchor(p.currentTime);
          });
          this.attach('playStateChange', e => { if (e?.detail != null) this.clock.setPlaying(e.detail === 'Playing'); });
          this.clock.setPlaying(api.getPlaybackStatus() === 'Playing');
          const timeline = api.getTimeline();
          if (timeline && Number.isFinite(timeline.currentTime)) this.clock.anchor(timeline.currentTime);
          this.setTrack(api.getCurrentSong());
          return;
        }
        if (++this.attempts >= 24) {
          clearInterval(this.retry); this.retry = null;
          this.error = 'InfLink-rs 不可用：无法读取可靠的播放状态';
          notify();
        }
      };
      attach();
      if (!this.api && this.attempts < 24) this.retry = setInterval(attach, 500);
    }
    attach(name, fn) {
      this.api.addEventListener(name, fn);
      this.listeners.push([name, fn]);
    }
    queueTrack(song) {
      this.pendingSong = song;
      if (this.songTask) return;
      this.songTask = setTimeout(() => {
        this.songTask = null;
        const next = this.pendingSong; this.pendingSong = null;
        this.setTrack(next ?? this.api?.getCurrentSong?.());
      }, 0);
    }
    async setTrack(song) {
      if (!song || typeof song !== 'object') return;
      const id = Number(song?.ncmId ?? song?.id);
      const key = id > 0 ? `ncm:${id}:${String(song?.trackId || '')}` : `local:${String(song?.trackId || '')}:${String(song?.songName || song?.name || '')}:${String(song?.authorName || song?.artist || '')}`;
      if (key === this.trackKey) return;
      const generation = ++this.generation;
      this.trackKey = key; this.title = String(song?.songName ?? song?.name ?? '');
      this.artist = String(song?.authorName ?? song?.artistName ?? song?.artist ?? '');
      this.durationMs = Number(song?.duration ?? 0);
      // The isolated NCM getPlayingSong() call hangs the host renderer on
      // playlist selection. Use the InfLink event payload and lyric result.
      this.trackInstrumental=Core.isNcmInstrumental(song);
      this.instrumentalHint=this.trackInstrumental?'网易云歌曲纯音乐标记':'';
      this.lines = []; this.kind = ''; this.provider=''; this.busy = false; this.error = ''; this.pureMusic=false;
      this.cancel?.abort();
      const ctrl = new AbortController(); this.cancel = ctrl;
      this.clock.reset();
      try { if (diag.trackTimeline) {
        if (diagMode === 'timeline-read-only') console.info('[FloatingCloud diagnostic] before track timeline');
        const current = this.api?.getTimeline();
        if (Number.isFinite(current?.currentTime)) this.clock.anchor(current.currentTime, this.api.getPlaybackStatus() === 'Playing');
        if (diagMode === 'timeline-read-only') console.info('[FloatingCloud diagnostic] after track timeline');
      }} catch (_) { /* ignore */ }
      if (!diag.lyricRequests) { notify(); return; }
      if (!this.title) {this.error='缺少歌曲名称，无法匹配本地或在线歌词';notify();return;}
      if (this.cache.has(key)) { const saved = this.cache.get(key); this.lines = saved.lines; this.kind = saved.kind;this.provider=saved.provider||'';this.pureMusic=Boolean(saved.pureMusic); notify(); return; }
      this.busy = true; notify();
      const timer = setTimeout(() => ctrl.abort(), 15500);
      let result=null, lastError='', autoOffline=false, helperResponded=false;
      try {
        // TaskbarLyrics Core's real QQMusic/QRC, Kugou/KRC, LRCLIB parsers.
        // The .NET helper is self-contained and launched by native.dll in a
        // background worker. Netease song metadata is used for matching only.
        const nativeApi=window.betterncm_native?.native_plugin;
        if(diag.nativeLyrics && nativeApi?.call) {
          try {
            const offlineHint=(typeof navigator !== 'undefined' && navigator.onLine===false);
            const manualFolders=settings.localLyricsFolders.split(/[;\r\n]+/).map(p=>p.trim()).filter(Boolean);
            // Client's own download directory first; manual roots are fallback.
            // No client configuration files are modified or uploaded.
            const ncmRoot=NcmPath?.getDownloadDir(window)||'';
            const localFolders=[...new Set([ncmRoot,...manualFolders].filter(Boolean))].slice(0,12);
            const request={
              TrackKey:key,Title:this.title,Artist:this.artist,Album:'',DurationMs:this.durationMs,
              Mode:settings.lyricsMode,LocalFolders:localFolders,OfflineHint:offlineHint
            };
            if(nativeApi.call('floatingcloud.lyricsLookup',[JSON.stringify(request)])==='started') {
              const limit=performance.now()+12500;
              while(!ctrl.signal.aborted && performance.now()<limit) {
                await new Promise(resolve=>setTimeout(resolve,200));
                const raw=nativeApi.call('floatingcloud.lyricsPoll',[]);
                if(!raw)continue;
                let response;
                try {response=JSON.parse(raw);}catch(_){break;}
                if(response.trackKey!==key)continue;
                helperResponded=true;
                if(response.error==='offline-no-local-lyrics')autoOffline=true;
                if(response.pureMusic) {this.pureMusic=true;break;}
                if(Array.isArray(response.lines) && response.lines.length) {
                  const lines=response.lines.filter(l=>l&&Number.isFinite(l.time)&&typeof l.text==='string')
                    .map(l=>({
                      time:l.time,duration:Number(l.duration||0),text:l.text,translation:String(l.translation||''),
                      words:Array.isArray(l.words)?l.words.filter(w=>w&&Number.isFinite(w.start))
                        .map(w=>({text:String(w.text||''),start:w.start,duration:Number(w.duration||0)})):[],
                      kind:l.kind||'lrc'
                    })).sort((a,b)=>a.time-b.time);
                  if(lines.length){result={lines,kind:response.kind||'lrc',provider:response.provider||'TBL'};break;}
                }
                break;
              }
            }
          }catch(e) {lastError=String(e.message||e);}
        }
        // LRCLIB has explicit CORS support and may supply word-timed Lyricsfile.
        // No invented word times: a strict song/artist/duration match is required.
        // The renderer's LRCLIB fallback is only legal in an ONLINE mode.
        // No HTTP request whatsoever is issued in local-only/offline state.
        const allowHttpFallback=!helperResponded && !autoOffline && settings.lyricsMode!=='local-only' &&
          !(typeof navigator !== 'undefined' && navigator.onLine===false);
        if (allowHttpFallback && !result && !this.pureMusic &&
            this.title && this.artist && !ctrl.signal.aborted) {
          const args=new URLSearchParams({track_name:this.title,artist_name:this.artist});
          if(this.durationMs > 1000) args.set('duration',String(Math.round(this.durationMs/1000)));
          const response=await fetch('https://lrclib.net/api/get?'+args,{
            signal:ctrl.signal,headers:{'Lrclib-Client':'FloatingCloud/0.4.3 (https://github.com/YuuFong/FloatingCloud)'}});
          if(response.status===429) throw Error('LRCLIB 请求过于频繁，稍后再试');
          const meta={title:this.title,artist:this.artist,durationMs:this.durationMs};
          if(response.status===200) {
            const record=await response.json();
            if(record.instrumental) this.pureMusic=true;
            result=Core.parseLrclibRecord(record,meta);
          }
          else if(response.status===404) {
            const searchUrl='https://lrclib.net/api/search?'+new URLSearchParams({
              track_name:this.title,artist_name:this.artist});
            const searchResp=await fetch(searchUrl,{signal:ctrl.signal,headers:{
              'Lrclib-Client':'FloatingCloud/0.4.3 (https://github.com/YuuFong/FloatingCloud)'}});
            if(searchResp.ok) {
              const candidates=await searchResp.json();
              if(Array.isArray(candidates)) {
                // Never accept title-only matches; prefer word-synced verified records.
                const matches=candidates.slice(0,25)
                  .map(r=>Core.parseLrclibRecord(r,meta)).filter(Boolean);
                matches.sort((a,b)=>Number(b.kind==='lyricsfile')-Number(a.kind==='lyricsfile'));
                result=matches[0]||null;
              }
            } else if(searchResp.status!==404)throw Error('LRCLIB search HTTP '+searchResp.status);
          } else throw Error('LRCLIB HTTP '+response.status);
        }
        if(this.generation!==generation || ctrl.signal.aborted) return;
        if(result?.lines?.length) {
          this.lines=result.lines;this.kind=result.kind;this.provider=result.provider;this.pureMusic=false;
          this.cache.set(key,result);
          if(this.cache.size>30) this.cache.delete(this.cache.keys().next().value);
        } else if(!this.pureMusic) this.error = '未找到可信的同步歌词';
      } catch(e) {
        if(this.generation===generation) this.error=ctrl.signal.aborted?'歌词请求超时或切歌取消':'歌词获取失败：'+String(e.message||e);
      } finally {
        clearTimeout(timer);
        if(this.generation===generation) {this.busy=false;notify();}
      }
    }
    refresh() {
      const song = this.api?.getCurrentSong?.();
      if (!song) { this.error = '没有可刷新的当前歌曲'; notify(); return; }
      this.cache.delete(this.trackKey);
      this.trackKey = ''; // force new request without requiring a song change
      this.setTrack(song);
    }
    destroy() {
      ++this.generation; clearTimeout(this.songTask); this.songTask=null;
      clearInterval(this.retry); this.cancel?.abort();
      for (const [name, fn] of this.listeners) this.api?.removeEventListener(name, fn);
      this.listeners = [];
    }
  }

  // Native host boundary. Every call is optional; the v0.3 preview remains usable if
  // DLL/WebView2 fails to load. No DesktopLyrics window takeover is attempted.
  class DesktopBridge {
    constructor() {
      this.enabled = false; this.locked = Boolean(plugin.getConfig('desktop-locked-v1', false));
      this.timer = null; this.sentLines = null; this.sentTrack = null;this.spectrumActive=false;this.sentPureMusic=null;this.sentSearching=null;this.spectrumCapture=false;
      this.widthAdjusting=false;
      this.message = '尚未启用'; this.pingOk = false;
    }
    call(method, args = []) {
      try {
        const api = window.betterncm_native?.native_plugin;
        if (!api || typeof api.call !== 'function') return null;
        return api.call('floatingcloud.' + method, args);
      } catch (error) {
        this.message = `Native 调用失败：${String(error?.message || error)}`;
        return null;
      }
    }
    probe() { return this.pingOk = this.call('ping') === 'native-loaded'; }
    // BetterNCM persists plugin config across NCM restart; no filesystem permissions.
    // The signed coordinates also support a secondary display placed left/up.
    parsePosition(value) {
      if(typeof value !== 'string')return null;
      const parts=value.split(',');
      if(parts.length!==2)return null;
      const x=Number(parts[0]),y=Number(parts[1]);
      if(!Number.isInteger(x)||!Number.isInteger(y) ||
         Math.abs(x)>100000||Math.abs(y)>100000)return null;
      return {x,y};
    }
    // Only a completed user drag may update the persisted placement.
    // Reading GetWindowRect on unload also captures transient HWND/DPI/clamp
    // positions and can cause a downward drift on every client restart.
    rememberPosition(value) {
      const position=this.parsePosition(value);
      if(!position)return;
      const saved=plugin.getConfig('desktop-position-v1',null);
      if(saved?.x===position.x && saved?.y===position.y)return;
      plugin.setConfig('desktop-position-v1',position);
    }
    status() {
      if (!this.pingOk && !this.probe()) return 'native.dll 未加载：请安装经过 Windows 构建的 .plugin';
      const result = this.call('status');
      const translations = { idle:'窗口未启动',starting:'正在初始化 WebView2',ready:'窗口可用',error:'WebView2 初始化失败，请检查 Runtime/Windows 事件日志' };
      return translations[result] || this.message;
    }
    enable() {
      if (!this.probe()) {this.message='native.dll 未加载';return false;}
      // Set dimensions BEFORE HWND creation: the saved x coordinate belongs
      // to the saved window width, not to a temporary 740px default.
      const pitch=Math.ceil(settings.fontSize*1.35+settings.lineGap);
      this.call('setInitialSize',[Math.round(settings.width)+','+(92+pitch*2+8)]);
      const saved=plugin.getConfig('desktop-position-v1',null);
      if(saved && Number.isInteger(saved.x) && Number.isInteger(saved.y) &&
        Math.abs(saved.x)<=100000 && Math.abs(saved.y)<=100000)
        this.call('setInitialPosition',[saved.x+','+saved.y]);
      if (this.call('open') !== 'started') {this.message='Native 窗口创建失败';return false;}
      this.enabled = true;
      this.applySettings(settings);
      // No second setPosition after sizing: it used to undo the current
      // centered resize by jumping to a stale startup coordinate.
      this.call('lock', [String(this.locked)]);
      this.call('show');
      this.sentTrack=null;this.sentLines=null;this.sentPureMusic=null;this.sentSearching=null;
      if (!this.timer) this.timer=setInterval(()=>this.tick(),100);
      this.tick();
      plugin.setConfig('desktop-visible-v1', true);
      this.message='窗口正在打开';return true;
    }
    disable() {
      if(this.enabled)this.rememberPosition(this.call('movedPosition'));
      this.enabled=false;
      plugin.setConfig('desktop-visible-v1', false);
      clearInterval(this.timer);this.timer=null;
      this.call('spectrumEnabled',['false']);this.spectrumActive=false;this.spectrumCapture=false;this.call('close');this.message='已关闭桌面浮窗';
    }
    unlock() {
      this.locked=false;plugin.setConfig('desktop-locked-v1',false);
      this.call('lock',['false']);this.message='已解锁：按住歌词本身即可拖动';
    }
    applySettings(s) {
      if (!this.enabled)return;
      this.call('settings',[JSON.stringify({...s,widthGuide:this.widthAdjusting})]);
      this.call('width',[String(Math.round(s.width))]);
      const pitch=Math.ceil(s.fontSize*1.35+s.lineGap);
      this.call('height',[String(92+pitch*2+8)]);
    }
    tick() {
      if (!this.enabled)return;
      const action = this.call('poll');
      // A distinct dirty-position channel avoids overwriting playback actions.
      const moved=this.call('movedPosition');
      if(moved)this.rememberPosition(moved);
      if (action === 'close') {this.disable();return;}
      if (action === 'lock') {this.locked=true;plugin.setConfig('desktop-locked-v1',true);}
      if (action === 'unlock') {this.unlock();}
      const api=live?.api;
      if (action === 'previous') api?.previous?.();
      else if (action === 'next') api?.next?.();
      else if (action === 'seekBack' || action === 'seekForward') {
        const current=api?.getTimeline?.()?.currentTime;
        if (Number.isFinite(current) && typeof api?.seekTo === 'function') {
          const dest=Math.max(0,current+(action==='seekBack'?-500:500));
          api.seekTo(dest);live?.clock.anchor(dest,api.getPlaybackStatus()==='Playing');
        }
      } else if (action === 'fontSmaller' || action === 'fontLarger') {
        setSettings({fontSize:Math.min(64,Math.max(14,settings.fontSize+(action==='fontLarger'?1:-1)))});
      }
      else if (action === 'toggle') {
        if (api?.getPlaybackStatus?.() === 'Playing') api.pause?.();
        else api?.play?.();
      }
      const song=live;
      // Searching and no lyrics are different states. No spectrum until
      // providers finish; do not gate the spectrum UI on playback status.
      const searching=Boolean(song?.trackKey && song?.busy);
      // TBL helpers can return explicit IsPureMusic or only a timestamped
      // "纯音乐，请欣赏" placeholder. Respect both; manual mode is an escape
      // hatch when a third-party source assigns bogus lyrics to an instrumental.
      const shouldSpectrum=diag.spectrum && Boolean(song?.trackKey &&
        Core.shouldDisplaySpectrum(song?.lines,song?.pureMusic,searching,settings.spectrumMode,
          song?.trackInstrumental));
      const shouldCapture=diag.spectrum && shouldSpectrum && Boolean(song?.clock.isPlaying());
      if(shouldCapture!==this.spectrumCapture) {
        this.spectrumCapture=shouldCapture;
        this.call('spectrumEnabled',[String(shouldCapture)]);
      }
      this.spectrumActive=diag.spectrum && shouldSpectrum;
      if (song?.lines!==this.sentLines || song?.trackKey!==this.sentTrack ||
          shouldSpectrum!==this.sentPureMusic || searching!==this.sentSearching) {
        this.sentLines=song?.lines;this.sentTrack=song?.trackKey;
        this.sentPureMusic=shouldSpectrum;this.sentSearching=searching;
        this.call('lyrics',[JSON.stringify({
          trackKey:song?.trackKey||'',title:song?.title||'',artist:song?.artist||'',
          lines:song?.lines||[],pureMusic:shouldSpectrum,searching
        })]);
      }
      this.call('timeline',[JSON.stringify({positionMs:(song?.clock.position()||0)+settings.offsetMs,playing: Boolean(song?.clock.isPlaying())})]);
    }
    shutdown() {
      if(this.enabled)this.rememberPosition(this.call('movedPosition'));
      clearInterval(this.timer);this.timer=null;
      this.call('spectrumEnabled',['false']);this.spectrumCapture=false;this.call('shutdown');
    }
  }

  const styleText = `
  .fc-panel{font-family:system-ui,'Microsoft YaHei',sans-serif;color:var(--mdc-theme-on-surface,#e4e7ef);padding:12px 8px 24px;max-width:930px}
  .fc-panel *{box-sizing:border-box}
  .fc-intro{opacity:.78;line-height:1.65;margin:7px 0 18px;font-size:13px}
  .fc-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
  .fc-btn{cursor:pointer;background:#34465f;border:1px solid #59718e;border-radius:8px;color:#fff;padding:7px 12px;font:inherit;font-size:13px}
  .fc-btn:focus-visible,.fc-control input:focus-visible,.fc-control select:focus-visible{outline:2px solid #81abef}
  .fc-status{font-size:12px;opacity:.8;line-height:1.6;min-height:20px}
  .fc-demo-wrap{overflow:hidden;background:radial-gradient(ellipse at center,#222a3e,#10151e);border:1px solid #3c4556;border-radius:14px;padding:12px;margin-bottom:18px}
  .fc-stage{position:relative;overflow:hidden;margin:0 auto;width:100%;height:160px;--fc-pitch:63px;--fc-shadow:3px;--fc-color:#fff;--fc-next:#bdc3d1;--fc-highlight:#fff;--fc-stroke:1px;--fc-stroke-color:#262c35;--fc-align:center}
  .fc-track{position:absolute;top:0;left:0;width:100%;transform:translate3d(0,0,0);will-change:transform}
  .fc-track.fc-no-anim,.fc-track.fc-no-anim .fc-line{transition:none!important;animation:none!important}
  /* TaskbarLyrics v1.7.4 .line: the same restrained text-shadow on every
     row, never an opaque drop-shadow/outline that changes apparent opacity. */
  .fc-line{height:var(--fc-pitch);display:flex;align-items:center;justify-content:center;text-align:var(--fc-align);overflow:hidden;white-space:nowrap;font-size:var(--fc-font-size);font-weight:var(--fc-weight);line-height:1.25;text-shadow:0 1px 2px rgba(0,0,0,.36);-webkit-text-stroke:0 transparent;transform-origin:center center;transition:transform var(--fc-roll-ms,560ms) cubic-bezier(0.22,0.72,0.24,1),opacity var(--fc-roll-ms,560ms) cubic-bezier(0.22,0.72,0.24,1),color 280ms ease}
  /* TBL original layer hierarchy: 90% primary × .98, 70% translated ×1,
     60% next × .72. No additional row opacity for translations. */
  .fc-line-primary{color:var(--fc-color);opacity:.98;transform:scale(1)}
  .fc-line-translation{color:var(--fc-translation);opacity:1;transform:scale(var(--fc-secondary-scale))}
  .fc-line.fc-pair-leaving{opacity:.16;transform:scale(.978)}
  .fc-line-primary.fc-leaving{opacity:.16;transform:scale(.972)}
  .fc-line-secondary{color:var(--fc-next);opacity:.72;transform:scale(var(--fc-secondary-scale))}
  .fc-line-secondary.fc-promoting{color:var(--fc-color);opacity:.98;transform:scale(1)}
  .fc-line-secondary.fc-incoming{opacity:0}
  .fc-text-box{position:relative;display:block;max-width:100%;margin:0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* TBL uses block .line-text layers. Clip/mask is unreliable on non-replaced
     inline spans, so keep FC's base and scan layers as real block boxes. */
  .fc-text-base{display:block;white-space:nowrap}

  /* TBL word-scanning: unplayed text is the 60%-alpha secondary color.
     The 90%-alpha played segment is a separate clipped/masked layer.
     Without scanning enabled, retain the normal 90%-alpha primary color. */
  .fc-stage.fc-scan-enabled .fc-line-primary .fc-text-base{color:var(--fc-next)}
  .fc-text-highlight{display:block;position:absolute;inset:0;color:var(--fc-color);pointer-events:none;clip-path:inset(0 calc(100% - var(--fc-progress,0%)) 0 0);white-space:nowrap}
  .fc-stage:not(.fc-scan-enabled) .fc-text-highlight{display:none}
  /* Playback-safe renderer: no per-frame mask-image or mask gradients.
     The clipped scan layer is fully opaque and noticeably brighter than the
     soft unplayed base. This avoids animated WebView2 GPU masks that may
     contribute to some systems freezing when playback starts. */
  .fc-word{display:inline-block;position:relative;white-space:pre;vertical-align:baseline}
  .fc-word-base{white-space:pre}
  .fc-word-highlight{position:absolute;inset:0;white-space:pre;color:var(--fc-highlight);pointer-events:none;clip-path:inset(0 calc(100% - var(--fc-word-progress,0%)) 0 0)}
  .fc-stage.fc-no-motion .fc-text-highlight,.fc-stage.fc-no-motion .fc-word-highlight{transition:none}
  /* rAF drives high-frequency YRC scanning; CSS transitions would restart every frame and lag. */
  .fc-group-heading{font-size:14px;font-weight:700;margin:20px 0 10px;color:#d9e6fc}
  .fc-mini{font-size:12px;opacity:.76;line-height:1.6}
  .fc-control select{max-width:100%;text-overflow:ellipsis}
  .fc-form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:13px 18px}
  .fc-control{display:flex;flex-direction:column;gap:7px;font-size:13px}
  .fc-control small{font-size:11px;opacity:.68}
  .fc-control input[type=range]{width:100%;accent-color:#7fa7ec}
  .fc-control input[type=color]{width:66px;height:28px;border:0;background:none}
  .fc-control select{height:32px;background:#293449;color:white;border:1px solid #586578;border-radius:5px;padding:4px}
  .fc-control input[type=checkbox]{margin-right:8px}
  .fc-hint{font-size:12px;opacity:.67;line-height:1.6;margin-top:20px}
  @media(prefers-reduced-motion:reduce){.fc-track{transition:none!important}}
  `;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  // Two visually stable lyric rows with an offscreen third row for the incoming line.
  // Adapted from TaskbarLyrics' separation of roll transitions and progress patches.
  class RollingView {
    constructor(stage) {
      this.stage = stage;
      this.track = el('div', 'fc-track'); stage.append(this.track);
      this.rows = [0, 1, 2, 3].map(() => el('div', 'fc-line'));
      this.rows.forEach(node => this.track.append(node));
      this.scanRows = [null, null, null, null];
      this.lines = []; this.index = null; this.settings = null;
      this.busy = false; this.pending = null; this.pairMode=false;
      this.timer = null; this.generation = 0; this.lastPosition = 0;
      this.presentation = new window.taskbarLyricsPresentation.PresentationCoordinator();
      this.renderTrackId = 0;
    }
    applySettings(s) {
      this.settings = s;
      this.pairMode = Boolean(s.showTranslation && this.lines.some(line=>String(line?.translation||'').trim()));
      // Use fixed row boxes: font difference is only a visual scale.
      this.pitch = Math.ceil(s.fontSize * 1.35 + s.lineGap);
      const v = this.stage.style;
      v.setProperty('--fc-pitch', this.pitch + 'px');
      v.setProperty('--fc-font-size', s.fontSize + 'px');
      v.setProperty('--fc-secondary-scale',String(Math.max(12,s.fontSize-2)/s.fontSize));
      v.setProperty('--fc-roll-ms',(560/s.animationSpeed)+'ms');
      v.setProperty('--fc-weight', String(s.fontWeight));
      const schemeLight=Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches);
      const palette=Core.lyricPalette(s.foregroundMode,schemeLight);
      v.setProperty('--fc-color', palette.primary);
      v.setProperty('--fc-translation', palette.translation);
      v.setProperty('--fc-next', palette.secondary);
      v.setProperty('--fc-highlight', palette.scan);
      // TBL's calibrated text-shadow keeps transparency consistent across
      // untranslated, translated and unplayed segments. Legacy stroke/shadow
      // settings remain in config for backward compatibility, not applied in
      // the faithful TBL color mode.
      v.setProperty('--fc-align', s.align);
      v.fontFamily = s.font;
      v.height = (this.pitch * 2) + 'px'; // exact viewport: row 3 is fully clipped
      v.maxWidth = s.width + 'px';
      this.stage.classList.toggle('fc-no-motion', !s.enableWordScan);
      this.stage.classList.toggle('fc-scan-enabled',Boolean(s.enableWordScan));
      this.cancelTransition();
      if (this.index !== null) {
        this.draw();
        this.renderScan(Core.lineProgress(this.lines, this.index, this.lastPosition), this.lastPosition, this.scanRows[0]);
      }
    }
    setLines(lines) {
      if (this.lines === lines) return;
      this.lines = Array.isArray(lines) ? lines : [];
      ++this.renderTrackId;
      this.cancelTransition(); this.index = null;
      if (this.settings) this.applySettings(this.settings);
    }
    cancelTransition() {
      ++this.generation;
      this.presentation.cancelTransition();
      clearTimeout(this.timer); this.timer = null;
      this.busy = false; this.pending = null;
      this.track.style.transition = 'none';
      this.track.style.transform = 'translate3d(0,0,0)';
      this.rows.forEach(r=>r.classList.remove('fc-leaving','fc-promoting','fc-pair-leaving'));
    }
    renderRow(rowIndex, lineIndex, translation=false) {
      const r=this.rows[rowIndex],line=this.lines[lineIndex];
      const primary=rowIndex===0 || (this.pairMode && rowIndex===2);
      r.className='fc-line '+(translation?'fc-line-translation':
        primary?'fc-line-primary':'fc-line-secondary');
      r.replaceChildren();
      const box=el('div','fc-text-box');
      const content=translation
        ? String(line?.translation||' ')
        : String(line?.text|| (rowIndex===0?'暂无歌词':' '));
      box.append(el('span','fc-text-base',content));
      if(!translation)box.append(el('span','fc-text-highlight',content));
      const words=line?.words||[];
      const timed=!translation&&words.length&&words.map(w=>w.text).join('').trim()===content.trim();
      this.scanRows[rowIndex]=translation?null:{mode:timed?'yrc':'lrc',node:box,lineIndex};
      r.append(box);
    }
    draw() {
      const index=Math.max(0,this.index??0);
      if(this.pairMode) {
        this.renderRow(0,index);
        this.renderRow(1,index,true);
        this.renderRow(2,index+1);
        this.renderRow(3,index+1,true);
      } else {
        for(let row=0;row<4;row++)this.renderRow(row,index+row);
      }
    }
    renderScan(progress, timeMs, scan) {
      if (!scan) return;
      const line=this.lines[scan.lineIndex];
      const value=this.settings.enableWordScan
        ? (scan.mode==='yrc' ? (Core.wordScanProgress(line,timeMs) ?? 0) : progress)
        : 0;
      scan.node.style.setProperty('--fc-progress',
        (Math.max(0,Math.min(1,value))*100).toFixed(3) + '%');
    }
    promote(nextIndex, ticket) {
      if (ticket !== this.generation) return;
      clearTimeout(this.timer); this.timer = null;
      // TBL's finalizeTransition: turn off *all* child transitions before
      // resetting font scaling and moving the content origin. The previous
      // implementation shifted live DOM rows, causing a white flash.
      this.track.classList.add('fc-no-anim');
      this.track.style.transition='none';
      this.rows[0].style.opacity='.16';
      this.rows[1].style.opacity='1';
      void this.track.offsetHeight;
      this.index=nextIndex;
      this.track.style.transform='translate3d(0,0,0)';
      this.draw();
      this.rows[0].classList.remove('fc-leaving','fc-promoting','fc-incoming');
      this.rows[1].classList.remove('fc-leaving','fc-promoting','fc-incoming');
      this.rows[2].classList.remove('fc-leaving','fc-promoting','fc-incoming');
      this.rows[3].classList.remove('fc-leaving','fc-promoting','fc-incoming','fc-pair-leaving');
      this.rows.forEach(r=>{r.style.opacity='';r.style.transform='';});
      this.renderScan(Core.lineProgress(this.lines,nextIndex,this.lastPosition),
        this.lastPosition,this.scanRows[0]);
      void this.track.offsetHeight;
      this.track.classList.remove('fc-no-anim');
      this.busy=false;
      const pending=this.pending;this.pending=null;
      if(pending)this.update(pending.index,pending.progress,pending.timeMs);
    }
    frameAt(index, progress, timeMs) {
      const safe=Math.max(0,index);
      return {
        scene:'lyrics',layout:this.pairMode?'translationPair':'single',
        trackId:String(this.renderTrackId),
        currentLineIndex:safe,
        current:this.lines[safe]?.text||'',
        next:this.lines[safe+1]?.text||'',
        currentTranslation:this.pairMode?this.lines[safe]?.translation||'':'',
        nextTranslation:this.pairMode?this.lines[safe+1]?.translation||'':'',
        progress,
        wordScanProgress:Core.wordScanProgress(this.lines[safe],timeMs),
        isPlaying:true
      };
    }
    update(index, progress, timeMs) {
      if (!this.settings?.enabled) { this.stage.style.opacity='.28'; return; }
      this.stage.style.opacity='1'; this.lastPosition=timeMs;
      if (index<0) {index=0;progress=0;}
      const target=this.frameAt(index,progress,timeMs);
      if (this.index === null) {
        this.index=index;this.draw();
        this.presentation.setCurrentFrame(target);
        this.renderScan(progress,timeMs,this.scanRows[0]);return;
      }
      if (this.busy) {
        this.pending={index,progress,timeMs};
        if(index===this.index+1) this.renderScan(progress,timeMs,this.scanRows[this.pairMode?2:1]);
        return;
      }
      const reduced=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const plan=this.presentation.plan(target,{reducedMotion:reduced});
      if (index===this.index || plan.kind==='progressPatch') {
        this.presentation.setCurrentFrame(target);
        this.renderScan(progress,timeMs,this.scanRows[0]);return;
      }
      if (index!==this.index+1 || reduced || !['singleRoll','translationPairRoll'].includes(plan.kind)) {
        this.cancelTransition();this.index=index;this.draw();
        this.presentation.setCurrentFrame(target);
        this.renderScan(progress,timeMs,this.scanRows[0]);return;
      }
      this.busy=true;
      const ticket=++this.generation;
      const duration=plan.durationMs/this.settings.animationSpeed;
      this.renderScan(progress,timeMs,this.scanRows[this.pairMode?2:1]);
      // TBL's coordinator owns the transitionend listener, rAF and fallback.
      // A completed row becomes the current row without rebuilding its glyphs.
      this.presentation.beginTransition(plan,{
        start: ctx => {
          this.track.style.transition='none';
          this.track.style.transform='translate3d(0,0,0)';
          this.rows[0].classList.add(this.pairMode?'fc-pair-leaving':'fc-leaving');
          if(this.pairMode)this.rows[1].classList.add('fc-pair-leaving');
          else this.rows[1].classList.add('fc-promoting');
          // Incoming second line is visible through the moving viewport,
          // exactly as in TBL; hiding it and revealing it only at the end
          // caused the next-line flash.
          this.rows[this.pairMode?3:2].classList.remove('fc-incoming');
          // Commit the starting geometry before starting the transform.
          void this.track.offsetHeight;
          this.track.style.transition='transform '+duration+'ms cubic-bezier(0.22,0.72,0.24,1)';
          const finish=()=>{if(ctx.isCurrent())ctx.finish();};
          ctx.listenTransitionEnd(this.track,e=>{
            if(e.target===this.track && e.propertyName==='transform')finish();
          });
          ctx.scheduleFallback(finish,duration+90);
          ctx.requestFrame(()=>{
            if(ctx.isCurrent() && ticket===this.generation)
              this.track.style.transform='translate3d(0,-'+(this.pairMode?this.pitch*2:this.pitch)+'px,0)';
          });
        },
        complete:()=>{
          if(ticket!==this.generation)return;
          // Commit the completed TBL presentation frame *before* replaying the
          // latest queued update, or a fast consecutive line change can snap.
          this.presentation.setCurrentFrame(target);
          this.promote(index,ticket);
        }
      });
    }
    destroy() { this.cancelTransition(); this.stage.replaceChildren(); }
  }

  plugin.onConfig(() => {
    const panel = el('section', 'fc-panel');
    const style = el('style'); style.textContent = styleText; panel.append(style);
    panel.append(el('h2', '', `FloatingCloud · 歌词显示 v${VERSION}`));
    const diagLabel=el('label','fc-control');
    diagLabel.append(el('span','','诊断模式（修改后重启网易云生效）'));
    const diagSelect=el('select');
    for(const [value,label] of [
      ['full','完整功能'],['no-preview','仅关闭设置页预览动画'],
      ['no-spectrum','仅关闭频谱采集'],['no-window','仅关闭桌面窗口通信'],
      ['no-native-lyrics','仅关闭 Native 歌词查询'],
      ['events-only','仅保留播放事件监听和基础曲目信息'],
      ['timeline-read-only','事件 + 仅读 InfLink 曲目时间轴'],
      ['lyrics-only','事件 + 仅歌词请求（不读网易云曲目状态、不启窗口）'],
      ['http-only','事件 + 仅在线歌词请求（不调用 Native、不启窗口）'],
      ['inert','仅加载插件，不启动播放监听、窗口或预览']
    ]) { const option=el('option','',label);option.value=value;diagSelect.append(option); }
    diagSelect.value=diagMode;
    diagSelect.addEventListener('change',()=>plugin.setConfig(DIAG_KEY,diagSelect.value));
    diagLabel.append(diagSelect);panel.append(diagLabel);
    panel.append(el('p','fc-hint','当前生效：'+diagMode+'。每次仅测试一个模式；切换后完整退出并重启网易云。此设置独立保存，不改动原有歌词偏好。'));
    panel.append(el('div', 'fc-intro', '设置自动保存。点击「打开桌面浮窗」后由 Native/WebView2 显示透明歌词；不会拦截网易云原生桌面歌词。'));
    const demoWrap = el('div', 'fc-demo-wrap');
    const stage = el('div', 'fc-stage'); demoWrap.append(stage);
    const status = el('div', 'fc-status', '预览模式'); demoWrap.append(status);
    const tools = el('div', 'fc-tools');
    const demoButton = el('button', 'fc-btn', '当前歌曲预览'); demoButton.type = 'button';
    const resetButton = el('button', 'fc-btn', '恢复默认参数'); resetButton.type = 'button';
    const refreshButton = el('button', 'fc-btn', '重新获取当前歌词'); refreshButton.type = 'button';
    const desktopToggle=el('button','fc-btn','打开桌面浮窗');desktopToggle.type='button';
    const unlockButton=el('button','fc-btn','解除浮窗锁定');unlockButton.type='button';
    const desktopStatus=el('p','fc-status','窗口宿主状态检查中');
    desktopToggle.addEventListener('click',()=>{
      if (!desktop)return;
      if (desktop.enabled)desktop.disable();else desktop.enable();
      updateDesktopStatus();
    });
    unlockButton.addEventListener('click',()=>{desktop?.unlock();updateDesktopStatus();});
    function updateDesktopStatus(){
      desktopToggle.textContent=desktop?.enabled?'关闭桌面浮窗':'打开桌面浮窗';
      const stored=plugin.getConfig('desktop-position-v1',null);
      const saved=Number.isInteger(stored?.x)&&Number.isInteger(stored?.y)
        ? stored.x+','+stored.y:'未存档';
      const actual=desktop?.enabled ? (desktop.call('getPosition')||'不可用') : '未显示';
      desktopStatus.textContent='桌面歌词：'+(desktop?.status()||'尚未初始化')+
        (desktop?.locked?' · 已锁定':' · 未锁定')+
        ' · 位置存档 '+saved+' · 当前窗口 '+actual+
        ' · 频谱 '+(desktop?.spectrumActive?'显示中':'未切换')+
        ' · 音频采集 '+(desktop?.spectrumCapture?'已请求':'未请求')+
        ' / '+(desktop?.spectrumCapture
          ? (desktop.call('spectrumStatus')==='available'?'设备已就绪':'音频设备尚未就绪')
          : '待命')+
        ' · 歌词 '+(live?.lines?.length||0)+'行'+
        (live?.pureMusic?'（歌词源纯音乐）':'')+
        (live?.trackInstrumental?'（网易云纯音乐标记）':'')+
        (Core.isInstrumentalRecord(live?.lines)?'（占位词+制作信息）':'');
    }
    tools.append(demoButton, refreshButton, resetButton, desktopToggle, unlockButton);
    demoWrap.append(tools, desktopStatus); panel.append(demoWrap);
    updateDesktopStatus();
    const desktopStatusTimer=setInterval(()=>{
      if (!panel.isConnected && mountedOnce) {clearInterval(desktopStatusTimer);return;}
      updateDesktopStatus();
    },1100);

    panel.append(el('h3', 'fc-group-heading', '文字与动画'));
    const grid = el('div', 'fc-form-grid'); panel.append(grid);
    const inputs = new Map();
    const configs = [
      ['enabled','启用预览','checkbox'], ['font','字体','select',Core.FONT_OPTIONS],
      ['fontWeight','字体粗细（参考 TaskbarLyrics）','select',Core.WEIGHT_OPTIONS],
      ['fontSize','主行字号（副行小 2px）','range',14,64,1],
      ['showTranslation','外文歌曲优先显示对应翻译（无翻译时保持双行）','checkbox'],
      ['foregroundMode','歌词前景色（参考 TBL：按透明度区分三行）','select',[
        {value:'system',label:'跟随系统'},
        {value:'light',label:'浅色歌词'},
        {value:'dark',label:'深色歌词'}
      ]],
      ['lineGap','行间距','range',0,40,1],
      ['spectrumGap','纯音乐频谱柱间距（px）','range',0,14,1],
      ['spectrumBarWidth','纯音乐频谱单柱宽度（px）','range',1,12,1],
      ['spectrumMode','频谱显示策略','select',[
        {value:'auto',label:'自动识别（默认）'},
        {value:'force-spectrum',label:'强制显示频谱（歌词误识别时）'},
        {value:'lyrics-only',label:'始终显示歌词'}
      ]],
      ['align','对齐方式','select',['left','center','right']],
      ['width','显示宽度（向左右对称伸缩）','range',300,1200,10],['offsetMs','歌词时间偏移（ms）','range',-5000,5000,50],
      ['animationSpeed','动画速度倍率','range',.5,2,.1],['enableWordScan','启用真实逐词高亮（YRC / Lyricsfile）或 LRC 行扫描','checkbox']
    ];
    for (const [key, caption, type, a, b, step] of configs) {
      const label = el('label','fc-control');
      const title = el('span', '', caption);
      const input = type === 'select' ? el('select') : el('input');
      if (type === 'select') for (const item of a) {
        const option = el('option','',typeof item === 'object' ? item.label : item);
        option.value = typeof item === 'object' ? item.value : item;
        input.append(option);
      }
      else { input.type = type; if (type === 'range') { input.min=a; input.max=b; input.step=step; } }
      const sub = el('small', '', '');
      const sync = () => {
        const v = settings[key];
        if (type === 'checkbox') input.checked = v;
        else input.value = v;
        sub.textContent = type === 'range' ? String(v) : '';
      };
      sync(); inputs.set(key, sync);
      input.addEventListener(type === 'range' || type === 'color' ? 'input' : 'change', () => {
        const val = type === 'checkbox' ? input.checked : (type === 'range' || key === 'fontWeight') ? Number(input.value) : input.value;
        if(key==='width' && desktop)desktop.widthAdjusting=true;
        setSettings({ [key]: val });
        // The preview/settings state is normalized synchronously, but the
        // numeric <small> label used to refresh only when the panel reopened.
        // Keep it in sync on EVERY input event, including during a drag.
        sync();
      });
      if(key==='width'){
        let guideTimeout=null;
        const finishWidthAdjustment=()=>{
          clearTimeout(guideTimeout);guideTimeout=null;
          if(desktop?.widthAdjusting){
            desktop.widthAdjusting=false;
            desktop.applySettings(settings);
          }
        };
        input.addEventListener('pointerdown',()=>{
          if(desktop){desktop.widthAdjusting=true;desktop.applySettings(settings);}
        });
        input.addEventListener('input',()=>{
          clearTimeout(guideTimeout);
          guideTimeout=setTimeout(finishWidthAdjustment,1100);
        });
        for(const event of ['pointerup','pointercancel','change','blur'])
          input.addEventListener(event,finishWidthAdjustment);
      }
      label.append(title, input, sub); grid.append(label);
    }
    panel.append(el('h3','fc-group-heading','歌词来源与离线使用'));
    const ncmAutoPath=NcmPath?.getDownloadDir(window)||'';
    const offlineGrid=el('div','fc-form-grid');panel.append(offlineGrid);
    const modeLabel=el('label','fc-control');
    modeLabel.append(el('span','','检索方式'));
    const modeSelect=el('select');
    const modeOptions=[
      ['online-first','在线优先 → 本地兜底（默认）'],
      ['local-first','本地优先 → 在线兜底'],
      ['local-only','仅本地歌词（不联网）']
    ];
    for(const [value,label] of modeOptions) {
      const option=el('option','',label);option.value=value;modeSelect.append(option);
    }
    modeSelect.value=settings.lyricsMode;
    modeSelect.addEventListener('change',()=>setSettings({lyricsMode:modeSelect.value}));
    modeLabel.append(modeSelect);offlineGrid.append(modeLabel);
    panel.append(el('p','fc-hint',ncmAutoPath
      ? '已自动检测到网易云下载目录：'+ncmAutoPath+'（无需填写）'
      : '尚未识别网易云下载目录；仍会搜索 Windows「音乐」文件夹，可在下方补充本地目录。'));
    const rootLabel=el('label','fc-control');
    rootLabel.append(el('span','','额外音乐/歌词目录（可选，多个路径用分号分隔）'));
    const rootsInput=el('input');
    rootsInput.type='text';rootsInput.value=settings.localLyricsFolders;
    rootsInput.placeholder='D:\\Music;E:\\Downloads\\Songs';
    rootsInput.spellcheck=false;
    rootsInput.addEventListener('change',()=>setSettings({localLyricsFolders:rootsInput.value}));
    rootLabel.append(rootsInput);offlineGrid.append(rootLabel);
    panel.append(el('p','fc-hint',
      '默认先检测网易云本身的下载目录，也搜索 Windows「音乐」文件夹；额外目录只在本机检索，不上传文件或路径。支持旁置 LRC/QRC/KRC 和部分音频内嵌歌词。下载目录里未必存有独立歌词文件，缺失时会继续回退。'));
    panel.append(el('p','fc-hint','字体提示：思源黑体只使用本机已安装字体，不会随插件附带字体文件；如本机没安装会自动使用后备字体。'));
    panel.append(el('p','fc-mini','逐词说明：YRC 提供词组起止时间，可逐词高亮；普通 LRC 只有整行时间戳，使用行级平滑扫描，不能还原真实的每个字时间。播放时间轴使用 InfLink-rs；仅浏览器预览不连接网易云。'));
    panel.append(el('p','fc-hint','边界：桌面浮窗为 Native/WebView2 Windows 实验版；不会自动替代原生 DesktopLyrics。点击歌词显示工具栏，直接按住歌词拖动，工具栏包含快退/快进半秒、上一曲、播放/暂停、下一曲、锁定和关闭；锁定后可从这里解锁。无歌曲进度条。'));
    const rolling = new RollingView(stage); rolling.applySettings(settings);
    let useDemo = true, raf = 0, lastTrackKey = null, lastLines = null;
    const sub = () => rolling.applySettings(settings); subscribers.add(sub);
    demoButton.addEventListener('click', () => {
      useDemo = !useDemo;
      demoButton.textContent = useDemo ? '当前歌曲预览' : '切换回演示歌词';
      lastLines = null; rolling.setLines([]);
    });
    refreshButton.addEventListener('click', () => live?.refresh());
    resetButton.addEventListener('click', () => {
      setSettings(Core.DEFAULTS);
      for (const sync of inputs.values()) sync();
    });
    const demoOrigin = performance.now();
    let mountedOnce = false, offscreenSince = 0;
    const drawFrame = (time) => {
      if (!panel.isConnected) {
        if (mountedOnce) {
          if (!offscreenSince) offscreenSince = time;
          if (time - offscreenSince > 1500) {
            subscribers.delete(sub); rolling.destroy();
            return; // release rAF when the settings panel has closed
          }
        }
        raf = requestAnimationFrame(drawFrame); return;
      }
      mountedOnce = true; offscreenSince = 0;
      const song = live;
      const showingReal = !useDemo;
      const lines = showingReal ? (song?.lines || []) : DEMO;
      const key = showingReal ? song?.trackKey : '__demo__';
      if (lines !== lastLines || key !== lastTrackKey) {
        rolling.setLines(lines); lastLines = lines; lastTrackKey = key;
      }
      const ms = showingReal
        ? (song?.clock.position() ?? 0) + settings.offsetMs
        : ((time - demoOrigin) % 14000) + settings.offsetMs;
      const idx = Core.resolveIndex(lines, ms);
      const progress = Core.lyricProgress(lines, idx, ms);
      rolling.update(idx, progress, ms);
      status.textContent = showingReal
        ? (!song?.api ? '未连接 InfLink-rs：缺少可靠播放时间轴' : song.busy ? `正在获取歌词：${song.title}` : song.error || `正在播放：${song.title || '未知歌曲'} · ${song.provider || '未知来源'} · ${(song.kind === 'yrc' || song.kind === 'lyricsfile') ? '逐词计时' : 'LRC 行级计时'}`)
        : 'YRC 逐词动画演示 · 14 秒循环，无需播放歌曲';
      raf = requestAnimationFrame(drawFrame);
    };
    if (diag.preview) raf = requestAnimationFrame(drawFrame);
    return panel;
  });

  const schemeQuery=window.matchMedia?.('(prefers-color-scheme: light)');
  schemeQuery?.addEventListener?.('change',()=>{
    notify(); // refresh the BetterNCM preview
    desktop?.applySettings(settings); // and the native lyrics renderer
  });
  plugin.onLoad(() => {
    if (live) live.destroy();
    if (diag.events) { live = new LiveLyrics(); live.init(); }
    if (diag.window) desktop = new DesktopBridge();
    // Never start an unverified native window unless user explicitly opted in earlier.
    if (desktop && plugin.getConfig('desktop-visible-v1',false)) desktop.enable();
  });
  plugin.onUnload?.(()=>{desktop?.shutdown();live?.destroy();});
  window.addEventListener('beforeunload',()=>{desktop?.shutdown();});

})();
