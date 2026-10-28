const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
const core=require('../plugin/core.js');
const NcmPath=require('../plugin/ncm-path.js');

function boot(settings,ncmStorage){
 NcmPath.resetForTests();
 let load,lookup=null;
 const writes=[];
 const native={call(name,args=[]){
   if(name==='floatingcloud.lyricsLookup')lookup=JSON.parse(args[0]);
   if(name==='floatingcloud.ping')return 'native-loaded';
   if(name==='floatingcloud.lyricsLookup')return 'started';
   return '';
 }};
 const win={
   FloatingCloudCore:core,
   FloatingCloudNcmPath:NcmPath,
   localStorage:{getItem:key=>key==='NM_SETTING_CUSTOM'?JSON.stringify({storage:{path:ncmStorage}}):null,
     setItem:()=>{throw Error('must not write to NetEase settings')}},
   betterncm_native:{native_plugin:native},
   InfLinkApi:{
     getCurrentSong:()=>({id:123,songName:'Offline Song',authorName:'A Singer',duration:120000}),
     getTimeline:()=>({currentTime:0}),getPlaybackStatus:()=> 'Paused',
     addEventListener:()=>{},removeEventListener:()=>{}
   },
   addEventListener:()=>{}
 };
 const plugin={
   getConfig:(key,defaultValue)=>key==='appearance-v2'?settings:defaultValue,
   setConfig:(key,value)=>writes.push({key,value}),
   onLoad:fn=>load=fn,
   onUnload:()=>{},onConfig:()=>{}
 };
 const sandbox={
   plugin,window:win,navigator:{onLine:false},
   AbortController,URLSearchParams,performance:{now:()=>0},console,
   setTimeout:()=>1,clearTimeout:()=>{},
   setInterval:()=>1,clearInterval:()=>{}
 };
 vm.runInNewContext(script,sandbox,{filename:'main.js'});
 load();
 return {lookup,writes};
}
test('actual NCM settings directory goes first, manual folder remains fallback',()=>{
 const {lookup,writes}=boot({lyricsMode:'local-only',
   localLyricsFolders:'E:\\Music;F:\\More'},'D:\\NetEase Downloads');
 assert.ok(lookup);
 assert.equal(lookup.Mode,'local-only');
 assert.equal(lookup.LocalFolders.length,3);
 assert.equal(lookup.LocalFolders[0],'D:\\NetEase Downloads');
 assert.equal(lookup.LocalFolders[1],'E:\\Music');
 assert.equal(lookup.LocalFolders[2],'F:\\More');
 assert.equal(writes.length,0);
});
test('missing client setting does not block user-specified local folders',()=>{
 const {lookup}=boot({lyricsMode:'local-only',
   localLyricsFolders:'E:\\Music'},'');
 assert.equal(lookup.LocalFolders[0],'E:\\Music');
});
