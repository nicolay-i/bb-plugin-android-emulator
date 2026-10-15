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
const html=readFileSync(new URL('./android.html',import.meta.url),'utf8');
const used=[...html.matchAll(/data-i18n(?:-label|-title|-placeholder)?="([^"]+)"|\b(?:t|notice)\('([^']+)'/g)].map(m=>m[1]||m[2]);
for(const key of used)assert.ok(Object.hasOwn(messages.en,key),`UI references missing key: ${key}`);
console.log(`PASS: ${Object.keys(messages).length} languages × ${keys.length} keys, placeholders, explicit language, browser fallback`);
