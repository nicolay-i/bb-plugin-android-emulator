import assert from 'node:assert/strict';
import { messages,languageOptions,resolveLanguage,translate } from './i18n.js';
const keys=Object.keys(messages.en).sort();
assert.ok(Object.keys(messages).length>=12);
assert.equal(languageOptions.length,Object.keys(messages).length+1);
for(const [language,entries]of Object.entries(messages)){
 assert.deepEqual(Object.keys(entries).sort(),keys,`${language}: missing keys`);
 for(const key of keys){
  assert.ok(entries[key].trim(),`${language}.${key}: empty`);
  assert.deepEqual(entries[key].match(/\{\w+\}/g)||[],messages.en[key].match(/\{\w+\}/g)||[],`${language}.${key}: placeholders`);
 }
 assert.ok(!translate(language,'launchNamed',{name:'test-device'}).includes('{name}'));
}
assert.equal(resolveLanguage('Русский',['en-US']),'ru');
assert.equal(resolveLanguage('Deutsch',['ru']),'de');
assert.equal(resolveLanguage('auto',['xx','ja-JP']),'ja');
assert.equal(resolveLanguage('auto',['zh-CN']),'zh');
assert.equal(resolveLanguage('auto',['pt-BR']),'pt');
assert.equal(resolveLanguage('auto',['xx']),'en');
assert.equal(resolveLanguage('constructor',['xx']),'en');
assert.equal(resolveLanguage('__proto__',['xx']),'en');
assert.equal(translate('xx','send'),'Send');
assert.ok(translate('en','launchNamed',{name:'<b>test</b>'}).includes('<b>test</b>'));
assert.equal(translate('__proto__','send'),'Send');
assert.equal(translate('en','__proto__'),'__proto__');
const {readFileSync}=await import('node:fs');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
// The panel's strings and the host error keys it maps (contract.ts).
const app=read('./app.tsx')+read('./contract.ts');
// Host and server errors carry i18n keys that the panel translates.
const hostErrors=[...['./host/android.ts','./host/session.ts','./server.ts','./contract.ts'].map(read).join('\n').matchAll(/Error\('(\w+)'\)/g)].map(m=>m[1]);
const checks=['sdk','adb','emulator','accel','avds'];
const generated=[...checks.map(id=>`check_${id}`),...checks.filter(id=>id!=='accel').map(id=>`hint_${id}`),'hint_accel_win','hint_accel_unix'];
const used=[...app.matchAll(/\bt\('(\w+)'/g)].map(m=>m[1]);
for(const key of [...used,...hostErrors,...generated])assert.ok(Object.hasOwn(messages.en,key),`UI references missing key: ${key}`);
for(const key of keys)assert.ok(generated.includes(key)||app.includes(`'${key}'`),`unused key: ${key}`);
console.log(`PASS: ${Object.keys(messages).length} languages × ${keys.length} keys, placeholders, UI and host error coverage`);
