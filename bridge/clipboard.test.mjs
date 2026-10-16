import assert from 'node:assert/strict';
import { copyToComputer } from './clipboard.js';
const text='Из Android ёж café 😀';
const standalone={navigator:{clipboard:{writeText:async value=>assert.equal(value,text)}}};standalone.parent=standalone;
assert.equal(await copyToComputer(text,standalone),true);
standalone.navigator.clipboard.writeText=async()=>{throw Error('NotAllowedError');};
assert.equal(await copyToComputer(text,standalone),false);
const listeners=new Set();
const embedded={addEventListener:(_,handler)=>listeners.add(handler),removeEventListener:(_,handler)=>listeners.delete(handler)};
embedded.parent={postMessage:message=>{
 assert.equal(message.text,text);
 // Ignore an unrelated frame, even if it guesses the request id.
 for(const receive of listeners)receive({source:{},data:{type:'bb-android-copy-result',id:message.id,ok:false}});
 for(const receive of listeners)receive({source:embedded.parent,data:{type:'bb-android-copy-result',id:message.id,ok:true}});
}};
assert.equal(await copyToComputer(text,embedded),true);assert.equal(listeners.size,0);
embedded.parent.postMessage=()=>{};
assert.equal(await copyToComputer(text,embedded,5),false);assert.equal(listeners.size,0);
assert.equal(await copyToComputer('я'.repeat(32769),embedded),false);
console.log('PASS: standalone copy, permission denial, BB copy handshake, sender validation, timeout and size limit');
