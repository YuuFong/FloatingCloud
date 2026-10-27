from pathlib import Path
p=Path(__file__).resolve().parents[1]/'plugin'/'main.js'
s=p.read_text(encoding='utf8')
s=s.replace("  let live = null;", "  let live = null;\n  let desktop = null;",1)
s=s.replace("    try { window.FloatingCloudHost?.setConfig?.(settings); } catch (e) { console.warn(e); }", "    try { desktop?.applySettings(settings); } catch (e) { console.warn(e); }",1)
marker='  const styleText = `'
assert marker in s
native='''  // Native host boundary. Every call is optional; the v0.3 preview remains usable if
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

'''
s=s.replace(marker,native+marker,1)
s=s.replace("    panel.append(el('h2', '', 'FloatingCloud · 歌词显示 v0.3.0'));", "    panel.append(el('h2', '', 'FloatingCloud · 歌词显示 v0.4.0（桌面浮窗实验版）'));",1)
s=s.replace("    panel.append(el('div', 'fc-intro', '设置自动保存。逐词时间轴取自网易云 YRC；无 YRC 时退回 LRC 行级扫描。原生桌面歌词保持不变。'));", "    panel.append(el('div', 'fc-intro', '设置自动保存。点击「打开桌面浮窗」后由 Native/WebView2 显示透明歌词；不会拦截网易云原生桌面歌词。'));",1)
s=s.replace("    tools.append(demoButton, refreshButton, resetButton); demoWrap.append(tools); panel.append(demoWrap);", """    const desktopToggle=el('button','fc-btn','打开桌面浮窗');desktopToggle.type='button';
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
""",1)
# NOTE: mountedOnce TDZ: interval only after 1100ms, declared later before callback => safe unless JS synchronous delay impossible.
s=s.replace("    panel.append(el('p','fc-hint','边界：不拦截原生 DesktopLyrics，不替换播放器资源，无歌曲进度条。本版仍是 BetterNCM 设置页预览，独立桌面浮窗尚未接入。'));", "    panel.append(el('p','fc-hint','边界：桌面浮窗为 Native/WebView2 Windows 实验版；不会自动替代原生 DesktopLyrics。桌面悬停按钮支持上/暂停/下一曲、锁定、关闭；锁定后请从这里解锁。无歌曲进度条。'));",1)
s=s.replace("    live = new LiveLyrics(); live.init();\n  });", """    live = new LiveLyrics(); live.init();
    desktop = new DesktopBridge();
    // Never start an unverified native window unless user explicitly opted in earlier.
    if (plugin.getConfig('desktop-visible-v1',false)) desktop.enable();
  });
  plugin.onUnload?.(()=>{desktop?.shutdown();live?.destroy();});
  window.addEventListener('beforeunload',()=>{desktop?.shutdown();});
""",1)
p.write_text(s,encoding='utf8')
print('Patched main.js',len(s))
