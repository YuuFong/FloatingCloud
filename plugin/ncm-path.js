/* FloatingCloud — read only the music-download directory the NetEase client
 * already configured. NCM v3 exposes SDK.Storage.downloadDir in its webpack
 * module cache; older clients may persist NM_SETTING_CUSTOM.storage.path.
 * No disk writes, no active changes to NCM settings, no network requests.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object' && module.exports)module.exports=api;
 if(root)root.FloatingCloudNcmPath=api;
})(typeof window!=='undefined'?window:null,()=>{
 'use strict';
 let sdk=null,attemptedCache=null,serial=0;
 function normalize(input){
   if(typeof input!=='string'||input.length>1024)return '';
   const path=input.trim().replace(/\//g,'\\').replace(/\\+$/,'');
   // Only Windows absolute drive paths or UNC shares; do not interpret
   // relative paths using the application working directory.
   const absolute=/^[a-zA-Z]:\\[^<>:"|?*\x00-\x1f]*$/.test(path) ||
      /^\\\\[^\\\x00-\x1f]+\\[^\\\x00-\x1f]+(?:\\[^<>:"|?*\x00-\x1f]*)*$/.test(path);
   if(!absolute||path.split('\\').some(part=>part==='.'||part==='..'))return '';
   return path;
 }
 function findCachedSdk(win){
   const chunks=win?.webpackJsonp;
   if(!chunks || !Array.isArray(chunks) || chunks.push===Array.prototype.push)return null;
   // Avoid reinjecting a chunk on every new track. Do not call NCM functions.
   if(attemptedCache===chunks)return sdk;
   attemptedCache=chunks;
   let loader=null;
   const key='fc_storage_reader_'+(++serial)+'_'+Date.now();
   try {
     chunks.push([[key],{[key]:(module,exports,require)=>{loader=require;}},[[key]]]);
     if(!loader?.c)return null;
     for(const cached of Object.values(loader.c)){
       const value=cached?.exports;
       if(value?.Storage && 'downloadDir' in value.Storage){
         sdk=value;return value;
       }
     }
   }catch(_){return null;}
   finally{
     if(loader?.c)delete loader.c[key];
     if(loader?.m)delete loader.m[key];
   }
   return null;
 }
 function fromSettings(win){
   try {
     const raw=win?.localStorage?.getItem('NM_SETTING_CUSTOM');
     const data=JSON.parse(raw||'null');
     return normalize(data?.storage?.path||'');
   }catch(_){return '';}
 }
 function getDownloadDir(win){
   try {
     const candidate=sdk || findCachedSdk(win);
     if(candidate?.Storage){
       const found=normalize(candidate.Storage.downloadDir);
       if(found)return found;
     }
   }catch(_){}
   return fromSettings(win);
 }
 function resetForTests(){sdk=null;attemptedCache=null;serial=0;}
 return {getDownloadDir,normalize,resetForTests};
});
