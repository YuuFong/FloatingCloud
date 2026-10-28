const test=require('node:test');
const assert=require('node:assert/strict');
const Ncm=require('../plugin/ncm-path.js');

test('NCM 3.x reads current SDK.Storage.downloadDir without changing settings',()=>{
  Ncm.resetForTests();
  let captured=0;
  const chunks=[];
  chunks.push=function(spec){
    captured++;
    const key=Object.keys(spec[1])[0];
    const req=()=>{};
    req.c={main:{exports:{Storage:{get downloadDir(){return 'D:/CloudMusic/';}}}}};
    req.m={[key]:spec[1][key]};
    spec[1][key]({}, {}, req);
    return 1;
  };
  const result=Ncm.getDownloadDir({webpackJsonp:chunks});
  assert.equal(result,'D:\\CloudMusic');
  assert.equal(captured,1);
  assert.equal(chunks.length,0);
  assert.equal(Ncm.getDownloadDir({webpackJsonp:chunks}),result);
  assert.equal(captured,1);
});
test('legacy NCM storage.path fallback remains read-only',()=>{
  Ncm.resetForTests();
  let writes=0;
  const win={localStorage:{
    getItem:key=>key==='NM_SETTING_CUSTOM'?JSON.stringify({storage:{path:'E:\\My Songs\\NetEase'}}):null,
    setItem:()=>{writes++}
  }};
  assert.equal(Ncm.getDownloadDir(win),'E:\\My Songs\\NetEase');
  assert.equal(writes,0);
});
test('invalid, relative and non-Windows paths never trigger directory scanning',()=>{
  const bad=['../Music','Music','file:///C:/music','D:/Music/../Private','C:\\Users\\..\\Hidden',
    '','C:\\Music|bad','C:\\A\0B','\\\\server','C:',32];
  for(const path of bad)assert.equal(Ncm.normalize(path),'',String(path));
  assert.equal(Ncm.normalize('D:/Music/FLAC'),'D:\\Music\\FLAC');
  assert.equal(Ncm.normalize('\\\\server\\music\\lyrics'),'\\\\server\\music\\lyrics');
});
test('SDK exceptions fall back to safe on-disk settings',()=>{
  Ncm.resetForTests();
  const chunks=[];
  chunks.push=()=>{throw Error('module injection unavailable')};
  const win={webpackJsonp:chunks,localStorage:{
    getItem:()=>JSON.stringify({storage:{path:'F:\\CloudMusic'}})
  }};
  assert.equal(Ncm.getDownloadDir(win),'F:\\CloudMusic');
});
