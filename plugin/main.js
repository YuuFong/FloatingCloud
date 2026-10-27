/* FloatingCloud Lite — BetterNCM settings + lyric preview, no native HWND takeover.
 * Animations reimplemented with TaskbarLyrics v1.7.4 timing values.
 */
(() => {
  'use strict';
  if (typeof plugin === 'undefined' || !window.FloatingCloudCore) return;
  const Core = window.FloatingCloudCore;
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
    settings = Core.normalizeSettings({ ...settings, ...patch });
    plugin.setConfig(KEY, settings);
    notify();
    // A future native window host may subscribe to these settings explicitly.
    try { desktop?.applySettings(settings); } catch (e) { console.warn(e); }
  };

  class LiveLyrics {
    constructor() {
      this.api = null; this.trackKey = ''; this.title = '';
      this.lines = []; this.kind = ''; this.error = ''; this.busy = false;
      this.clock = Core.createClock(); this.listeners = [];
      this.cancel = null; this.retry = null; this.attempts = 0;
      this.cache = new Map();
    }
    init() {
      const attach = () => {
        const api = window.InfLinkApi;
        if (api && typeof api.getCurrentSong === 'function' && typeof api.addEventListener === 'function') {
          clearInterval(this.retry); this.retry = null; this.api = api;
          this.attach('songChange', e => this.setTrack(e?.detail ?? api.getCurrentSong()));
          this.attach('timelineUpdate', e => {
            const p = e?.detail ?? api.getTimeline();
            if (Number.isFinite(p?.currentTime)) this.clock.anchor(p.currentTime, api.getPlaybackStatus() === 'Playing');
          });
          this.attach('playStateChange', e => this.clock.setPlaying((e?.detail ?? api.getPlaybackStatus()) === 'Playing'));
          this.clock.setPlaying(api.getPlaybackStatus() === 'Playing');
          const timeline = api.getTimeline();
          if (timeline && Number.isFinite(timeline.currentTime)) this.clock.anchor(timeline.currentTime);
          this.setTrack(api.getCurrentSong());
          return;
        }
        if (++this.attempts >= 24) {
          clearInterval(this.retry); this.retry = null;
          // Minimal metadata-only fallback: not a reliable lyric timeline.
          try {
            const song = window.betterncm?.ncm?.getPlayingSong?.();
            if (song?.id) this.setTrack({ ncmId: song.id, songName: song.name ?? '', authorName: '' });
          } catch (_) { /* unavailable */ }
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
    async setTrack(song) {
      const id = Number(song?.ncmId ?? song?.id);
      const key = id > 0 ? `ncm:${id}:${String(song?.trackId || '')}` : `local:${String(song?.trackId || '')}`;
      if (key === this.trackKey) return;
      this.trackKey = key; this.title = String(song?.songName ?? song?.name ?? '');
      this.lines = []; this.kind = ''; this.busy = false; this.error = '';
      this.cancel?.abort();
      const ctrl = new AbortController(); this.cancel = ctrl;
      this.clock.reset();
      try {
        const current = this.api?.getTimeline();
        if (Number.isFinite(current?.currentTime)) this.clock.anchor(current.currentTime, this.api.getPlaybackStatus() === 'Playing');
      } catch (_) { /* ignore */ }
      if (!(id > 0)) { this.error = song?.trackId ? '本地歌曲暂不支持在线歌词直连' : '暂无正在播放的歌曲'; notify(); return; }
      if (this.cache.has(key)) { const saved = this.cache.get(key); this.lines = saved.lines; this.kind = saved.kind; notify(); return; }
      this.busy = true; notify();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        // Uses the same NCM lyric endpoint demonstrated by AMLL's BetterNCM adapter.
        const base = (typeof window.APP_CONF?.domain === 'string' && /^https:\/\//.test(window.APP_CONF.domain))
          ? window.APP_CONF.domain : 'https://music.163.com';
        const url = `${base}/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=${encodeURIComponent(id)}`;
        const resp = await fetch(url, { signal: ctrl.signal });
        if (!resp.ok) throw Error(`歌词接口 HTTP ${resp.status}`);
        const data = await resp.json();
        const result = Core.parseNcmLyrics(data);
        if (this.trackKey !== key || ctrl.signal.aborted) return;
        this.lines = result.lines; this.kind = result.kind;
        if (!result.lines.length) this.error = '没有找到同步歌词';
        this.cache.set(key, result);
        if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
      } catch (e) {
        if (this.trackKey === key) this.error = ctrl.signal.aborted ? '歌词请求超时或切歌取消' : `歌词获取失败：${String(e.message || e)}`;
      } finally {
        clearTimeout(timer);
        if (this.trackKey === key) { this.busy = false; notify(); }
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
      this.timer = null; this.sentLines = null; this.sentTrack = null;
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
    status() {
      if (!this.pingOk && !this.probe()) return 'native.dll 未加载：请安装经过 Windows 构建的 .plugin';
      const result = this.call('status');
      const translations = { idle:'窗口未启动',starting:'正在初始化 WebView2',ready:'窗口可用',error:'WebView2 初始化失败，请检查 Runtime/Windows 事件日志' };
      return translations[result] || this.message;
    }
    enable() {
      if (!this.probe()) {this.message='native.dll 未加载';return false;}
      if (this.call('open') !== 'started') {this.message='Native 窗口创建失败';return false;}
      this.enabled = true;this.call('show');
      this.applySettings(settings);
      this.call('lock', [String(this.locked)]);
      this.sentTrack=null;this.sentLines=null;
      if (!this.timer) this.timer=setInterval(()=>this.tick(),100);
      this.tick();
      plugin.setConfig('desktop-visible-v1', true);
      this.message='窗口正在打开';return true;
    }
    disable() {
      this.enabled=false;
      plugin.setConfig('desktop-visible-v1', false);
      clearInterval(this.timer);this.timer=null;
      this.call('close');this.message='已关闭桌面浮窗';
    }
    unlock() {
      this.locked=false;plugin.setConfig('desktop-locked-v1',false);
      this.call('lock',['false']);this.message='已解锁：拖动上方细条可移动位置';
    }
    applySettings(s) {
      if (!this.enabled)return;
      this.call('settings',[JSON.stringify(s)]);
      this.call('width',[String(Math.round(s.width))]);
    }
    tick() {
      if (!this.enabled)return;
      const action = this.call('poll');
      if (action === 'close') {this.disable();return;}
      if (action === 'lock') {this.locked=true;plugin.setConfig('desktop-locked-v1',true);}
      const api=live?.api;
      if (action === 'previous') api?.previous?.();
      else if (action === 'next') api?.next?.();
      else if (action === 'toggle') {
        if (api?.getPlaybackStatus?.() === 'Playing') api.pause?.();
        else api?.play?.();
      }
      const song=live;
      if (song?.lines!==this.sentLines || song?.trackKey!==this.sentTrack) {
        this.sentLines=song?.lines;
        this.sentTrack=song?.trackKey;
        this.call('lyrics',[JSON.stringify({trackKey:song?.trackKey||'',title:song?.title||'',lines:song?.lines||[]})]);
      }
      this.call('timeline',[JSON.stringify({positionMs:(song?.clock.position()||0)+settings.offsetMs,playing: Boolean(song?.clock.isPlaying())})]);
    }
    shutdown() {
      clearInterval(this.timer);this.timer=null;
      this.call('shutdown');
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
  .fc-track{position:absolute;top:16px;left:0;width:100%;transform:translate3d(0,0,0);will-change:transform}
  .fc-line{height:var(--fc-pitch);display:flex;flex-direction:column;align-items:stretch;justify-content:center;text-align:var(--fc-align);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1.22;filter:drop-shadow(0px 1px var(--fc-shadow) rgba(0,0,0,.8));-webkit-text-stroke:var(--fc-stroke) var(--fc-stroke-color)}
  .fc-line-primary{font-size:var(--fc-font-size);font-weight:var(--fc-weight);color:var(--fc-color)}
  .fc-line-secondary{font-size:var(--fc-next-size);font-weight:var(--fc-weight);color:var(--fc-next)}
  .fc-line-paired .fc-text-box{font-size:var(--fc-font-size)}
  .fc-line-secondary.fc-line-paired .fc-text-box{font-size:var(--fc-next-size)}
  .fc-line-paired .fc-subline{font-size:var(--fc-next-size);color:var(--fc-next);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-top:3px}
  .fc-text-box{position:relative;display:block;max-width:100%;margin:0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fc-text-highlight{position:absolute;inset:0;color:var(--fc-highlight);pointer-events:none;clip-path:inset(0 calc(100% - var(--fc-progress,0%)) 0 0);white-space:nowrap}
  .fc-word{display:inline-block;position:relative;white-space:pre;vertical-align:baseline}
  .fc-word-base{white-space:pre}
  .fc-word-highlight{position:absolute;inset:0;white-space:pre;color:var(--fc-highlight);pointer-events:none;clip-path:inset(0 calc(100% - var(--fc-word-progress,0%)) 0 0)}
  .fc-stage.fc-no-motion .fc-text-highlight,.fc-stage.fc-no-motion .fc-word-highlight{transition:none}
  .fc-stage:not(.fc-no-motion) .fc-text-highlight{transition:clip-path 90ms linear}
  .fc-stage:not(.fc-no-motion) .fc-word-highlight{transition:clip-path 90ms linear}
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
  class RollingView {
    constructor(stage) {
      this.stage = stage;
      this.track = el('div', 'fc-track'); stage.appendChild(this.track);
      this.rows = [0, 1, 2].map(() => el('div', 'fc-line'));
      this.rows.forEach(r => this.track.append(r));
      this.index = null; this.busy = false; this.pending = null;
      this.timer = null; this.generation = 0; this.lines = [];
      this.scanRows = [null, null, null]; this.lastPosition = 0;
    }
    applySettings(s) {
      this.settings = s;
      this.paired = Boolean(s.showTranslation && this.lines.some(l => l.translation));
      const v = this.stage.style;
      const pitch = this.paired
        ? Math.ceil(s.fontSize * 1.3 + s.nextFontSize * 1.35 + s.lineGap + 10)
        : Math.ceil(Math.max(s.fontSize * 1.3, s.nextFontSize * 1.45) + s.lineGap);
      this.pitch = pitch;
      v.setProperty('--fc-pitch', pitch + 'px'); v.setProperty('--fc-font-size', s.fontSize + 'px');
      v.setProperty('--fc-next-size', s.nextFontSize + 'px');
      v.setProperty('--fc-weight', String(s.fontWeight));
      v.setProperty('--fc-color', s.color); v.setProperty('--fc-next', s.nextColor);
      v.setProperty('--fc-highlight', s.highlight); v.setProperty('--fc-stroke', s.strokeWidth + 'px');
      v.setProperty('--fc-stroke-color', s.strokeColor); v.setProperty('--fc-shadow', s.shadow + 'px');
      v.setProperty('--fc-align', s.align); v.fontFamily = s.font;
      v.height = (pitch * (this.paired ? 1 : 2) + 16) + 'px';
      v.maxWidth = s.width + 'px';
      this.stage.classList.toggle('fc-no-motion', !s.enableWordScan);
      this.cancelTransition();
      if (this.index !== null) { this.draw(); this.renderScan(0, this.lastPosition, this.scanRows[0]); }
    }
    setLines(lines) {
      if (this.lines === lines) return;
      this.lines = lines || []; this.cancelTransition(); this.index = null;
      if (this.settings) this.applySettings(this.settings);
    }
    cancelTransition() {
      this.generation++; clearTimeout(this.timer); this.timer = null;
      this.busy = false; this.pending = null; this.track.style.transition = 'none';
      this.track.style.transform = 'translate3d(0,0,0)';
    }
    draw() {
      const i = Math.max(0, this.index ?? 0);
      this.scanRows = [null, null, null];
      this.rows.forEach((r, row) => {
        const line = this.lines[i + row];
        const primary = row === 0;
        r.className = 'fc-line ' + (primary ? 'fc-line-primary' : 'fc-line-secondary') +
          (this.paired ? ' fc-line-paired' : '');
        r.replaceChildren();
        const container = el('div', 'fc-text-box');
        const content = line?.text || (primary ? '暂无歌词' : '');
        const segments = [];
        if (line?.words?.length && line.words.map(w => w.text).join('').trim() === content.trim()) {
          // Actual YRC word timestamps; each token owns an independently clipped overlay.
          for (const word of line.words) {
            const wordNode = el('span', 'fc-word');
            wordNode.append(el('span', 'fc-word-base', word.text));
            const highlighted = el('span', 'fc-word-highlight', word.text);
            wordNode.append(highlighted); container.append(wordNode);
            segments.push({ word, node: wordNode });
          }
          this.scanRows[row] = { segments, mode: 'yrc' };
        } else {
          container.append(el('span', 'fc-text-base', content));
          const highlighted = el('span', 'fc-text-highlight', content);
          container.append(highlighted);
          this.scanRows[row] = { node: container, mode: 'lrc' };
        }
        r.append(container);
        if (this.paired) r.append(el('div', 'fc-subline', line?.translation || '　'));
      });
    }
    // Like TaskbarLyrics, frequent progress updates do not restart rolling transitions.
    renderScan(progress, timeMs, scan) {
      if (!scan) return;
      if (scan.mode === 'yrc') {
        for (const { word, node } of scan.segments) {
          const value = this.settings.enableWordScan ? Core.wordProgress(word, timeMs) : 1;
          node.style.setProperty('--fc-word-progress', `${(value * 100).toFixed(3)}%`);
        }
      } else {
        const value = this.settings.enableWordScan ? progress : 1;
        scan.node.style.setProperty('--fc-progress', `${(Math.max(0,Math.min(1,value)) * 100).toFixed(3)}%`);
      }
    }
    update(index, progress, timeMs) {
      if (!this.settings?.enabled) { this.stage.style.opacity = '.28'; return; }
      this.stage.style.opacity = '1'; this.lastPosition = timeMs;
      // Before first timestamp do not highlight upcoming lyrics.
      if (index < 0) { index = 0; progress = 0; }
      if (this.index === null) { this.index = index; this.draw(); }
      if (this.busy) {
        this.pending = { index, progress, timeMs };
        this.renderScan(progress, timeMs, this.scanRows[1]);
        return;
      }
      if (index === this.index) { this.renderScan(progress, timeMs, this.scanRows[0]); return; }
      if (index !== this.index + 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        this.index = index; this.draw(); this.renderScan(progress, timeMs, this.scanRows[0]); return;
      }
      this.busy = true;
      const ticket = ++this.generation;
      const duration = (this.paired ? 760 : 560) / this.settings.animationSpeed;
      this.renderScan(progress, timeMs, this.scanRows[1]);
      this.track.style.transition = `transform ${duration}ms cubic-bezier(0.22,0.72,0.24,1)`;
      requestAnimationFrame(() => {
        if (ticket === this.generation) this.track.style.transform = `translate3d(0,-${this.pitch}px,0)`;
      });
      this.timer = setTimeout(() => {
        if (ticket !== this.generation) return;
        this.index = index;
        this.track.style.transition = 'none';
        this.track.style.transform = 'translate3d(0,0,0)';
        this.draw(); this.busy = false;
        const queued = this.pending; this.pending = null;
        const target = queued ?? { index, progress, timeMs };
        if (target.index === this.index) this.renderScan(target.progress, target.timeMs, this.scanRows[0]);
        else this.update(target.index, target.progress, target.timeMs);
      }, duration + 28);
    }
    destroy() { this.cancelTransition(); this.stage.replaceChildren(); }
  }

  plugin.onConfig(() => {
    const panel = el('section', 'fc-panel');
    const style = el('style'); style.textContent = styleText; panel.append(style);
    panel.append(el('h2', '', 'FloatingCloud · 歌词显示 v0.4.0（桌面浮窗实验版）'));
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
      desktopStatus.textContent='桌面歌词：'+(desktop?.status()||'尚未初始化')+(desktop?.locked?' · 已锁定':' · 未锁定');
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
      ['fontSize','主行字号','range',14,64,1],['nextFontSize','副行字号','range',12,56,1],
      ['color','文字颜色','color'],['nextColor','副行颜色','color'],['highlight','扫描高亮颜色','color'],
      ['strokeWidth','描边宽度','range',0,5,.2],['strokeColor','描边颜色','color'],
      ['shadow','阴影强度','range',0,16,1],['lineGap','行间距','range',0,40,1],
      ['align','对齐方式','select',['left','center','right']],
      ['width','显示宽度','range',300,1200,10],['offsetMs','歌词时间偏移（ms）','range',-5000,5000,50],
      ['animationSpeed','动画速度倍率','range',.5,2,.1],['enableWordScan','启用逐词高亮（YRC）/行级扫描（LRC）','checkbox'],['showTranslation','有翻译时显示译文','checkbox']
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
        setSettings({ [key]: val });
      });
      label.append(title, input, sub); grid.append(label);
    }
    panel.append(el('p','fc-hint','字体提示：思源黑体只使用本机已安装字体，不会随插件附带字体文件；如本机没安装会自动使用后备字体。'));
    panel.append(el('p','fc-mini','逐词说明：YRC 提供词组起止时间，可逐词高亮；普通 LRC 只有整行时间戳，使用行级平滑扫描，不能还原真实的每个字时间。播放时间轴使用 InfLink-rs；仅浏览器预览不连接网易云。'));
    panel.append(el('p','fc-hint','边界：桌面浮窗为 Native/WebView2 Windows 实验版；不会自动替代原生 DesktopLyrics。桌面悬停按钮支持上/暂停/下一曲、锁定、关闭；锁定后请从这里解锁。无歌曲进度条。'));
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
        ? (!song?.api ? '未连接 InfLink-rs：缺少可靠播放时间轴' : song.busy ? `正在获取歌词：${song.title}` : song.error || `正在播放：${song.title || '未知歌曲'} · ${song.kind === 'yrc' ? 'YRC 逐词计时' : 'LRC 行级计时'}`)
        : 'YRC 逐词动画演示 · 14 秒循环，无需播放歌曲';
      raf = requestAnimationFrame(drawFrame);
    };
    raf = requestAnimationFrame(drawFrame);
    return panel;
  });

  plugin.onLoad(() => {
    if (live) live.destroy();
    live = new LiveLyrics(); live.init();
    desktop = new DesktopBridge();
    // Never start an unverified native window unless user explicitly opted in earlier.
    if (plugin.getConfig('desktop-visible-v1',false)) desktop.enable();
  });
  plugin.onUnload?.(()=>{desktop?.shutdown();live?.destroy();});
  window.addEventListener('beforeunload',()=>{desktop?.shutdown();});

})();
