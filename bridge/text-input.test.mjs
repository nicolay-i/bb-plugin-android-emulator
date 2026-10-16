import assert from 'node:assert/strict';
import { unicodeKey,attachUnicodeInput } from './text-input.js';
for (const key of ['Ж','ё','é','你','😀']) assert.equal(unicodeKey({key}),true,key);
for (const key of ['a','Enter','Backspace','Dead','ArrowLeft']) assert.equal(unicodeKey({key}),false,key);
assert.equal(unicodeKey({key:'Я',ctrlKey:true}),false);
assert.equal(unicodeKey({key:'Я',metaKey:true}),false);
assert.equal(unicodeKey({key:'Я',isComposing:true}),false);
assert.equal(unicodeKey({key:'ą',ctrlKey:true,altKey:true,getModifierState:key=>key==='AltGraph'}),true);
const target=new EventTarget(), sent=[],errors=[];
let active=0;
const dispose=attachUnicodeInput(target,async text=>{
 assert.equal(active++,0,'Unicode paste requests must preserve order');
 await new Promise(resolve=>setTimeout(resolve,2));
 sent.push(text);active--;
},error=>errors.push(error));
function key(type,value){const event=new Event(type,{cancelable:true});Object.defineProperty(event,'key',{value});target.dispatchEvent(event);return event;}
assert.equal(key('keydown','Ж').defaultPrevented,true);
assert.equal(key('keydown','ё').defaultPrevented,true);
assert.equal(key('keydown','a').defaultPrevented,true);
target.dispatchEvent(new Event('compositionstart'));
key('keydown','你');
const composed=new Event('compositionend');Object.defineProperty(composed,'data',{value:'你好'});target.dispatchEvent(composed);
await new Promise(resolve=>setTimeout(resolve,30));
assert.deepEqual(sent,['Ж','ё','a','你好']);assert.deepEqual(errors,[]);
dispose();key('keydown','Я');await Promise.resolve();assert.equal(sent.length,4);
console.log('PASS: Unicode keys, shortcuts, composition, ordered paste and cleanup');
