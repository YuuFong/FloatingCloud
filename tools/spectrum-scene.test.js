const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function makeScene(){
  const html=fs.readFileSync(path.join(__dirname,'../plugin/desktop.html'),'utf8');
  const begin=html.indexOf('function applyLyricRows(');
  const end=html.indexOf('window.chrome?.webview?.addEventListener',begin);
  assert.ok(begin>0&&end>begin);
  const frames=[],timers=[];
  const classes=new Set();
  const root={offsetHeight:1,classList:{
    add:(...names)=>names.forEach(name=>classes.add(name)),
    remove:(...names)=>names.forEach(name=>classes.delete(name)),
    contains:name=>classes.has(name)
  }};
  const stage={style:{transition:'',opacity:''}};
  const view={lines:[],setLines(value){this.lines=value;},applySettings(){}};
  const context={root,stage,view,settings:{},Core:{normalizeChorusIntervals:()=>[]},
    window:{matchMedia:()=>({matches:false})},
    requestAnimationFrame:fn=>frames.push(fn),
    setTimeout:(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},
    clearTimeout:timer=>{if(timer)timer.cancelled=true;},
    setMessage:()=>{},renderPlayState:()=>{},applySpectrumGeometry:()=>{},hideControls:()=>{},openControls:()=>{},
    clock:{anchor:()=>{}},spectrumBars:[],spectrumTargets:[],rootStyle:{setProperty:()=>{}}
  };
  vm.runInNewContext(`let lines=[],searching=false,pureMusic=false,lastTrackKey='',chorusIntervals=[],swapTimer=null;
    let spectrumPhase='lyrics',spectrumTimer=null,spectrumTicket=0,displayedSearching=false;
    let playStatus=false,locked=false;
    ${html.slice(begin,end)}
    this.probe=()=>({phase:spectrumPhase,lines,searching,pureMusic,swapTimer});`,context);
  const flushFrames=()=>{for(const fn of frames.splice(0))fn();};
  const flushTimer=delay=>{
    const timer=timers.find(item=>!item.cancelled&&item.delay===delay);
    assert.ok(timer,`pending ${delay}ms timer`);
    timer.cancelled=true;timer.fn();
  };
  return {context,root,stage,view,flushFrames,flushTimer};
}

test('searching to no-lyrics spectrum enters with both layers and then settles',()=>{
  const scene=makeScene();
  scene.context.receive({type:'lyrics',payload:{trackKey:'a',title:'无歌词',searching:true}});
  const searchRows=scene.view.lines;
  scene.context.receive({type:'lyrics',payload:{trackKey:'a',title:'无歌词',searching:false,lines:[],pureMusic:true}});
  assert.equal(scene.context.probe().phase,'entering');
  assert.equal(scene.root.classList.contains('spectrum-entering'),true);
  assert.equal(scene.root.classList.contains('pure-music'),false);
  assert.equal(scene.view.lines,searchRows);
  scene.flushFrames();
  assert.equal(scene.root.classList.contains('spectrum-entry-active'),true);
  scene.flushTimer(380);
  assert.equal(scene.context.probe().phase,'spectrum');
  assert.equal(scene.root.classList.contains('pure-music'),true);
});

test('spectrum exit keeps searching visible until a fast lyric result is ready',()=>{
  const scene=makeScene();
  scene.context.receive({type:'lyrics',payload:{trackKey:'a',searching:false,lines:[],pureMusic:true}});
  scene.flushFrames();scene.flushTimer(380);
  scene.context.receive({type:'lyrics',payload:{trackKey:'b',title:'新歌',searching:true}});
  assert.equal(scene.context.probe().phase,'exiting');
  assert.equal(scene.root.classList.contains('spectrum-exiting'),true);
  const searchRows=scene.view.lines;
  scene.flushFrames();
  const result=[{time:0,duration:2000,text:'新歌词'}];
  scene.context.receive({type:'lyrics',payload:{trackKey:'b',searching:false,lines:result}});
  assert.equal(scene.view.lines,searchRows);
  scene.flushTimer(380);
  assert.equal(scene.context.probe().phase,'lyrics');
  assert.equal(scene.view.lines,searchRows);
  scene.flushTimer(170);
  assert.equal(scene.view.lines,scene.context.probe().lines);
  assert.equal(scene.view.lines[0].text,'新歌词');
});

test('new spectrum result cancels an unfinished exit',()=>{
  const scene=makeScene();
  scene.context.receive({type:'lyrics',payload:{trackKey:'a',pureMusic:true,lines:[]}});
  scene.flushFrames();scene.flushTimer(380);
  scene.context.receive({type:'lyrics',payload:{trackKey:'b',searching:true}});
  scene.context.receive({type:'lyrics',payload:{trackKey:'b',pureMusic:true,lines:[]}});
  assert.equal(scene.context.probe().phase,'spectrum');
  assert.equal(scene.root.classList.contains('pure-music'),true);
  assert.equal(scene.root.classList.contains('spectrum-exiting'),false);
});
