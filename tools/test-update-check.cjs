const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const updater = require('../plugin/update-check.js');

test('version precedence and v prefix', () => {
  assert.equal(updater.compareVersions('v0.4.38', '0.4.37'), 1);
  assert.equal(updater.compareVersions('0.4.37','v0.4.37'), 0);
  assert.equal(updater.compareVersions('0.4.3','0.4.13'), -1);
  assert.equal(updater.compareVersions('0.4.38-beta.1','0.4.38'), -1);
  assert.equal(updater.compareVersions('0.4.38','0.4.38-beta.2'), 1);
  assert.equal(updater.compareVersions('bad', '0.4.38'), null);
});

test('valid published release and plugin package', () => {
  const release = { tag_name:'v0.4.39', draft:false, prerelease:false,
    assets:[{ name:'FloatingCloud-v0.4.39.plugin' }] };
  assert.deepEqual(updater.evaluateRelease('0.4.38',release), {
    currentVersion:'0.4.38',latestVersion:'0.4.39',
    updateAvailable:true,aheadOfRelease:false,hasPlugin:true,releasesUrl:updater.RELEASES_URL
  });
  assert.equal(updater.evaluateRelease('0.4.39',release).updateAvailable,false);
  assert.equal(updater.evaluateRelease('0.4.40',release).updateAvailable,false);
  assert.equal(updater.evaluateRelease('0.4.40',release).aheadOfRelease,true);
  assert.equal(updater.evaluateRelease('0.4.38',{...release,assets:[]}).hasPlugin,false);
  assert.equal(updater.evaluateRelease('0.4.38',{...release,assets:[{name:'FloatingCloud-v0.4.40.plugin'}]}).hasPlugin,false);
  assert.throws(()=>updater.evaluateRelease('0.4.38',{...release,prerelease:true}));
});

test('HTTP failures are reported and no unknown update is announced', async () => {
  await assert.rejects(()=>updater.checkLatest('0.4.38',async()=>({status:404,ok:false})),/正式 Release/);
  await assert.rejects(()=>updater.checkLatest('0.4.38',async()=>({status:403,ok:false})),/受限/);
  await assert.rejects(()=>updater.checkLatest('0.4.38',async()=>({status:500,ok:false})),/HTTP 500/);
  const signal = new AbortController().signal;
  const release = {tag_name:'v0.4.39',draft:false,prerelease:false,assets:[{name:'FloatingCloud-v0.4.39.plugin'}]};
  const result = await updater.checkLatest('0.4.38',async(url,opts)=>{
    assert.equal(url,updater.API_URL);
    assert.equal(opts.signal,signal);
    return {ok:true,status:200,json:async()=>release};
  },{signal});
  assert.equal(result.updateAvailable,true);
});

test('manifest version and script loading remain in sync', () => {
  const plugin = path.join(__dirname,'..','plugin');
  const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'),'utf8'));
  const scripts=manifest.injects.Main.map(x=>x.file);
  assert.ok(scripts.indexOf('update-check.js')>=0);
  assert.ok(scripts.indexOf('update-check.js')<scripts.indexOf('main.js'));
  const main=fs.readFileSync(path.join(plugin,'main.js'),'utf8');
  assert.ok(main.includes("const VERSION = '"+manifest.version+"';"));
});
