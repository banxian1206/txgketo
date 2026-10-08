const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('frontend/public/design-lab/proposals/purchase-workbench.html','utf8');
assert(html.includes('data-prototype-loading'));
assert(html.includes('html[data-prototype-loading] body{visibility:hidden}'));
const scripts=[...html.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/g)];
assert(scripts.length>1);assert(scripts.every(s=>/\bdefer\b/.test(s[1])));
assert(scripts.at(-1)[2].startsWith('purchase-boot.js'));
const source=fs.readFileSync('frontend/public/design-lab/proposals/purchase-boot.js','utf8');
function run(errors){let pending,visible=false,failed=false;const state={window:{purchasePrototypeBootErrors:errors,showPurchasePrototypeBootError(){failed=true}},document:{documentElement:{removeAttribute(name){assert.equal(name,'data-prototype-loading');visible=true}}},requestAnimationFrame(callback){pending=callback}};vm.runInNewContext(source,state);return{tick(){pending?.()},snapshot(){return{visible,failed}}}}
const ready=run([]);assert.deepEqual(ready.snapshot(),{visible:false,failed:false});ready.tick();assert.deepEqual(ready.snapshot(),{visible:true,failed:false});
const failed=run(['script failure']);failed.tick();assert.deepEqual(failed.snapshot(),{visible:false,failed:true});
const lateErrors=[],late=run(lateErrors);lateErrors.push('initialization failed');late.tick();assert.deepEqual(late.snapshot(),{visible:false,failed:true});
console.log('PASS: ordered deferred scripts, hidden initial DOM, reveal after initialization, failure keeps partial UI hidden.');
