from pathlib import Path
import re
p=Path(__file__).resolve().parents[1]/'plugin'
source=(p/'main.js').read_text(encoding='utf8')
core=(p/'core.js').read_text(encoding='utf8')
presentation=(p/'vendor'/'tbl-presentation.js').read_text(encoding='utf8')
start=source.index('  const styleText = `')
end=source.index('  plugin.onConfig(() =>',start)
renderer=source[start:end]
# Keep exactly the RollingView from plugin config, avoiding competing animation implementations.
assert 'class RollingView' in renderer and 'function el(' in renderer
assert not '</script' in renderer.lower()
html='''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:"Microsoft YaHei",sans-serif;color:white;user-select:none}
#root{width:100%;height:100%;padding:0 10px;box-sizing:border-box;display:block;position:relative}
#toolbar{position:absolute;left:50%;top:49px;transform:translate(-50%,9px);display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:4px;width:calc(100% - 24px);max-width:680px;border:0;border-radius:0;padding:0;background:transparent;box-shadow:none;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:100;white-space:nowrap}
#root.controls-open #toolbar{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
#root.is-locked #toolbar,#root.is-locked #mini-settings{display:none!important}
#root.settings-open #toolbar{visibility:hidden;pointer-events:none}
#toolbar .fc-tools-left,#toolbar .fc-tools-right{display:flex;gap:4px;align-items:center;min-width:0}
#toolbar .fc-tools-left{justify-content:flex-end}
#toolbar .fc-tools-right{justify-content:flex-start}
#toolbar button{color:white;font:600 15px "Segoe UI Symbol","Microsoft YaHei",sans-serif;border:0;background:transparent;cursor:pointer;padding:5px 8px;border-radius:6px}
#toolbar button:hover,#toolbar button:focus-visible{background:transparent;color:#aaccff;filter:drop-shadow(0 1px 3px #000b)}
#resize-guide{position:absolute;top:92px;left:0;right:0;bottom:8px;background:rgba(16,20,30,.58);border:1px solid rgba(190,203,226,.38);border-radius:7px;box-sizing:border-box;opacity:0;pointer-events:none;transition:opacity 130ms ease;z-index:1}
#root.width-adjusting #resize-guide{opacity:1}
#stage{z-index:2;width:100%;position:absolute;top:92px;left:0;right:0;min-height:0;overflow:hidden;box-sizing:border-box;background:transparent!important;border:0;margin:0 auto}
#stage .fc-track{top:0}
#stage .fc-line{filter:drop-shadow(0 1px var(--fc-shadow) rgba(0,0,0,.85))}
#state{position:absolute;top:5px;left:15px;color:#afbdd5;font-size:11px;opacity:0;pointer-events:none;white-space:nowrap;text-overflow:ellipsis;max-width:95%;overflow:hidden}
#root.controls-open #state{opacity:.85}
#stage{cursor:grab}#stage:active{cursor:grabbing}
#mini-settings{position:absolute;left:50%;top:46px;transform:translateX(-50%);border-radius:10px;padding:5px 8px;background:rgba(25,31,41,.94);display:none;z-index:101;white-space:nowrap;font-size:12px}
#mini-settings.open{display:flex;align-items:center;gap:8px}
#mini-settings button{background:transparent;color:white;border:0;border-radius:0;padding:3px 8px;cursor:pointer}
#spectrum{width:100%;position:absolute;top:92px;left:0;right:0;bottom:0;display:none;
 align-items:center;justify-content:center;gap:var(--fc-spectrum-gap,3px);pointer-events:none;opacity:0;transition:opacity 300ms ease}
#root.pure-music #spectrum{display:flex;opacity:.95}
#root.pure-music #stage{visibility:hidden}
#spectrum span{width:3px;min-width:3px;height:5px;background:var(--fc-spectrum-color,#d4d9e5);
 border-radius:99px;transform-origin:center bottom;box-shadow:0 1px 3px rgba(0,0,0,.6);
 transition:background 280ms ease,opacity 260ms ease;opacity:.78}
@media(prefers-reduced-motion:reduce){#spectrum span{transition:none}}
</style></head><body>
<div id="root"><div id="toolbar"><div class="fc-tools-left"><button data-action="seekBack" title="后退0.5秒">−0.5s</button><button data-action="seekForward" title="前进0.5秒">+0.5s</button><button data-action="previous" title="上一曲">⏮</button></div><button data-action="toggle" id="play-pause" title="播放/暂停">Ⅱ</button><div class="fc-tools-right"><button data-action="next" title="下一曲">⏭</button><button id="gear" title="快速设置">⚙</button><button data-action="lock" title="锁定，鼠标穿透">♙</button><button data-action="close" title="关闭浮窗">✕</button></div></div><div id="mini-settings">统一字号 <button data-action="fontSmaller" title="减小字号">−</button><button data-action="fontLarger" title="增大字号">+</button><span>更多参数在 BetterNCM 插件设置中</span></div><div id="resize-guide" aria-hidden="true"></div><div id="stage" class="fc-stage"></div><div id="spectrum" aria-label="系统音频频谱"></div><div id="state"></div></div>
<script>
'''+core+'''
</script><script>
'''+presentation+'''
</script><script>
(() => {'use strict';
const Core = window.FloatingCloudCore;
'''+renderer+'''
let settings=Core.normalizeSettings({}),lines=[],lastTrackKey='',clock=Core.createClock();
let ready=false,view=null,lastUpdate=0,playStatus=false,controlsTimer=null,locked=false,pureMusic=false,searching=false,swapTimer=null;
const stage=document.getElementById('stage'), state=document.getElementById('state');
const root=document.getElementById('root'),toolbar=document.getElementById('toolbar');
function postAction(action){ try{window.chrome?.webview?.postMessage(action)}catch(e){console.warn(e)} }
function hideControls(){
 clearTimeout(controlsTimer);controlsTimer=null;
 root.classList.remove('controls-open','settings-open');
 document.getElementById('mini-settings').classList.remove('open');
 if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 postAction('settingsClosed');postAction('controlsClosed');
}
function openControls(){
 if(locked)return;
 root.classList.add('controls-open');postAction('controlsOpen');
 clearTimeout(controlsTimer);
 controlsTimer=setTimeout(hideControls,3500);
}
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',ev=>{
 ev.stopPropagation();postAction(b.dataset.action);
 if(b.dataset.action==='lock'||b.dataset.action==='close')hideControls();
 else openControls();
}));
document.getElementById('gear').addEventListener('click',ev=>{
 ev.stopPropagation();
 const active=document.getElementById('mini-settings').classList.toggle('open');
 root.classList.toggle('settings-open',active);
 postAction(active?'settingsOpen':'settingsClosed');openControls();
});
const spectrumEl=document.getElementById('spectrum');
// Keep all 32 columns inside the available WebView width even when the
// requested gap is wide or the lyrics window is set to its minimum width.
function applySpectrumGap(){
 const desired=Math.max(0,Number(settings.spectrumGap)||0);
 const limit=Math.max(0,(window.innerWidth-120)/31);
 spectrumEl.style.setProperty('--fc-spectrum-gap',Math.min(desired,limit)+'px');
}
window.addEventListener('resize',applySpectrumGap);
applySpectrumGap();
const spectrumBars=Array.from({length:32},(_,i)=>{
 const bar=document.createElement('span');bar.dataset.index=String(i);spectrumEl.append(bar);return bar;
});
let spectrumTargets=spectrumBars.map(()=>0),spectrumVisuals=spectrumBars.map(()=>0),lastSpectrumTime=0;
function renderSpectrumFrame(now){
 const elapsed=lastSpectrumTime?Math.max(.5,Math.min(2.4,(now-lastSpectrumTime)/16.67)):1;
 lastSpectrumTime=now;
 spectrumBars.forEach((bar,i)=>{
   const target=pureMusic&&playStatus?(spectrumTargets[i]||0):0;
   const old=spectrumVisuals[i],rate=target>old?.70:.35;
   const value=old+(target-old)*(1-Math.pow(1-rate,elapsed));
   spectrumVisuals[i]=value;
   bar.style.height=Math.round(6+value*26)+'px';
 });
 requestAnimationFrame(renderSpectrumFrame);
}
requestAnimationFrame(renderSpectrumFrame);
function renderPlayState(){document.getElementById('play-pause').textContent=playStatus?'Ⅱ':'▶';}
function setMessage(msg){state.textContent=msg||''}
function receive(message){
  if (!message || typeof message !== 'object')return;
  switch(message.type){
    case 'settings':settings=Core.normalizeSettings(message.payload);view.applySettings(settings);root.classList.toggle('width-adjusting',Boolean(message.payload?.widthGuide));root.style.setProperty('--fc-spectrum-color',Core.lyricPalette(settings.foregroundMode,Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches)).spectrum);applySpectrumGap();break;
    case 'lyrics':{
      const p=message.payload||{};
      if(p.trackKey===lastTrackKey&&lines.length&&p.lines===undefined)return;
      const wasSearching=searching;
      lastTrackKey=String(p.trackKey||'');
      searching=Boolean(p.searching);
      lines=searching
        ? [
            {time:0,duration:3600000,text:[p.title,p.artist].filter(Boolean).join(' — ')||'正在识别歌曲',words:[]},
            {time:3600000,duration:3600000,text:'正在获取歌词…',words:[]}
          ]
        : Array.isArray(p.lines)?p.lines.slice(0,300):[];
      pureMusic=Boolean(p.pureMusic)&&!searching;
      root.classList.toggle('pure-music',pureMusic);
      if(wasSearching && !searching && !pureMusic && lines.length) {
        stage.style.transition='opacity 170ms ease';
        stage.style.opacity='0.12';
        clearTimeout(swapTimer);
        swapTimer=setTimeout(()=>{
          view.setLines(lines);view.applySettings(settings);
          stage.style.opacity='1';
        },170);
      } else {
        clearTimeout(swapTimer);
        stage.style.opacity='1';
        view.setLines(lines);view.applySettings(settings);
      }
      setMessage(p.title||'');break;
    }
    case 'timeline':{
      const p=message.payload||{};
      if(Number.isFinite(p.positionMs))clock.anchor(p.positionMs, Boolean(p.playing));
      playStatus=Boolean(p.playing);renderPlayState();break;
    }
    case 'spectrum':
      if(Array.isArray(message.payload)&&message.payload.length) {
        spectrumTargets=spectrumBars.map((_,i)=>Math.max(0,Math.min(1,Number(message.payload[i]||0))));
      } else spectrumTargets=spectrumBars.map(()=>0);
      break;
    case 'locked':locked=Boolean(message.payload);root.classList.toggle('is-locked',locked);if(locked)hideControls();break;
    case 'interaction':
      if(message.payload?.lyricClick&&!locked){
        if(root.classList.contains('controls-open'))hideControls();else openControls();
      }break;
  }
}
window.chrome?.webview?.addEventListener('message',ev=>receive(ev.data));
view=new RollingView(stage);view.applySettings(settings);
window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change',()=>{
 view.applySettings(settings);
 root.style.setProperty('--fc-spectrum-color',Core.lyricPalette(settings.foregroundMode,Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches)).spectrum);
});
// Browser-only mock: deliberate and explicit. No fake playback in production WebView2.
if(!window.chrome?.webview){
 lines=Core.parseNcmLyrics({yrc:{lyric:'[0,3000](0,800,0)窗外(800,700,0)的风(1500,1000,0)吹过\\n[3000,3000](0,900,0)平凡(900,900,0)时刻(1800,900,0)发光\\n[6000,3000](0,800,0)把日子(800,900,0)写成(1700,950,0)一首歌'}}).lines;
 view.setLines(lines);view.applySettings(settings);clock.anchor(0,true);playStatus=true;renderPlayState();setMessage('浏览器演示模式');
}
function raf(){
 const pos=searching?0:clock.position(),index=searching?0:Core.resolveIndex(lines,pos),progress=searching?0:Core.lyricProgress(lines,index,pos);
 view.update(index,progress,pos);
 requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
})();
</script></body></html>'''
# Inline renderer's css text onto document with a small boot script; reuse CSS verbatim from v0.3.
html=html.replace('view=new RollingView(stage);view.applySettings(settings);','const css=document.createElement("style");css.textContent=styleText;document.head.append(css);\nview=new RollingView(stage);view.applySettings(settings);')
(p/'desktop.html').write_text(html,encoding='utf8')
print('Generated desktop.html',len(html),'chars')
