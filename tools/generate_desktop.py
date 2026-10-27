from pathlib import Path
import re
p=Path(__file__).resolve().parents[1]/'plugin'
source=(p/'main.js').read_text(encoding='utf8')
core=(p/'core.js').read_text(encoding='utf8')
start=source.index('  const styleText = `')
end=source.index('  plugin.onConfig(() =>',start)
renderer=source[start:end]
# Keep exactly the RollingView from plugin config, avoiding competing animation implementations.
assert 'class RollingView' in renderer and 'function el(' in renderer
assert not '</script' in renderer.lower()
html='''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:"Microsoft YaHei",sans-serif;color:white;user-select:none}
#root{width:100%;height:100%;padding:0 10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;position:relative}
#drag{height:20px;position:absolute;left:10px;right:10px;top:0;cursor:move}
#drag:before{content:"";position:absolute;left:calc(50% - 26px);width:52px;top:8px;height:3px;border-radius:8px;background:rgba(255,255,255,.18)}
#toolbar{position:absolute;left:50%;top:17px;transform:translate(-50%,-10px);display:flex;gap:6px;border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:6px 8px;background:rgba(15,21,33,.87);box-shadow:0 8px 25px #0005;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:100}
#root:hover #toolbar,#toolbar:focus-within{opacity:1;pointer-events:auto;transform:translate(-50%,8px)}
#toolbar button{color:white;font:14px sans-serif;border:0;background:transparent;cursor:pointer;padding:5px 10px;border-radius:8px}
#toolbar button:hover,#toolbar button:focus-visible{background:#566986}
#stage{width:100%;flex:none;min-height:0;overflow:hidden;position:relative;background:transparent!important;border:0;margin:0 auto}
#stage .fc-track{top:23px}
#stage .fc-line{filter:drop-shadow(0 1px var(--fc-shadow) rgba(0,0,0,.85))}
#state{position:absolute;bottom:2px;left:15px;color:#afbdd5;font-size:11px;opacity:0;pointer-events:none}
#root:hover #state{opacity:.8}
</style></head><body>
<div id="root"><div id="drag" title="按住此处拖动歌词"></div><div id="toolbar"><button data-action="previous" title="上一曲">⏮</button><button data-action="toggle" title="播放/暂停">⏯</button><button data-action="next" title="下一曲">⏭</button><button data-action="lock" title="锁定（设置页解锁）">🔒</button><button data-action="close" title="关闭歌词浮窗">✕</button></div><div id="stage" class="fc-stage"></div><div id="state"></div></div>
<script>
'''+core+'''
</script><script>
(() => {'use strict';
const Core = window.FloatingCloudCore;
'''+renderer+'''
let settings=Core.normalizeSettings({}),lines=[],lastTrackKey='',clock=Core.createClock();
let ready=false,view=null,lastUpdate=0,playStatus=false;
const stage=document.getElementById('stage'), state=document.getElementById('state');
function postAction(action){ try{window.chrome?.webview?.postMessage(action)}catch(e){console.warn(e)} }
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>postAction(b.dataset.action)));
function setMessage(msg){state.textContent=msg||''}
function receive(message){
  if (!message || typeof message !== 'object')return;
  switch(message.type){
    case 'settings':settings=Core.normalizeSettings(message.payload);view.applySettings(settings);break;
    case 'lyrics':{
      const p=message.payload||{};
      if(p.trackKey===lastTrackKey&&lines.length&&p.lines===undefined)return;
      lastTrackKey=String(p.trackKey||'');lines=Array.isArray(p.lines)?p.lines.slice(0,300):[];
      view.setLines(lines);view.applySettings(settings);
      setMessage(p.title||'');break;
    }
    case 'timeline':{
      const p=message.payload||{};
      if(Number.isFinite(p.positionMs))clock.anchor(p.positionMs, Boolean(p.playing));
      break;
    }
    case 'locked':document.getElementById('toolbar').style.display=message.payload?'none':'flex';break;
  }
}
window.chrome?.webview?.addEventListener('message',ev=>receive(ev.data));
view=new RollingView(stage);view.applySettings(settings);
// Browser-only mock: deliberate and explicit. No fake playback in production WebView2.
if(!window.chrome?.webview){
 lines=Core.parseNcmLyrics({yrc:{lyric:'[0,3000](0,800,0)窗外(800,700,0)的风(1500,1000,0)吹过\\n[3000,3000](0,900,0)平凡(900,900,0)时刻(1800,900,0)发光\\n[6000,3000](0,800,0)把日子(800,900,0)写成(1700,950,0)一首歌'}}).lines;
 view.setLines(lines);view.applySettings(settings);clock.anchor(0,true);setMessage('浏览器演示模式');
}
function raf(){
 const pos=clock.position(),index=Core.resolveIndex(lines,pos),progress=Core.lyricProgress(lines,index,pos);
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
