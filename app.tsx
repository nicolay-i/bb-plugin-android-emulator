import { useEffect,useState,useRef } from 'react';
import { definePluginApp,useRpc,experimental_copyToClipboard } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contract';
import { themeTokens } from './theme';
import { resolveLanguage,translate } from './bridge/i18n.js';
function Emulator(){
 const rpc=useRpc<typeof rpcContract>();
 const [language,setLanguage]=useState(()=>resolveLanguage('auto',navigator.languages));
 const frame=useRef<HTMLIFrameElement>(null);
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
   let live=true;
   async function load(){
     try{
       const {viewerUrl,language:preference}=await rpc.call('config',null);
       if(live)setLanguage(resolveLanguage(preference,navigator.languages));
       const u=new URL(viewerUrl);
       if(u.protocol!=='https:')throw new Error('configure');
       if(live){setUrl(new URL('/android.html',u).href);setError('');}
     }catch{if(live)setError('configure');}
   }
   void load();const timer=setInterval(()=>void load(),5000);
   return()=>{live=false;clearInterval(timer);};
 },[rpc]);
 useEffect(()=>{
   const iframe=frame.current;if(!iframe||!url)return;
   const origin=new URL(url).origin;
   const media=window.matchMedia('(prefers-color-scheme: dark)');
   const publish=()=>{
     const style=getComputedStyle(iframe);
     const scheme=style.colorScheme;
     const mode=scheme==='dark'?'dark':scheme==='light'?'light':media.matches?'dark':'light';
     const colors:Record<string,string>={};
     for(const [key,token]of Object.entries(themeTokens)){
       const value=style.getPropertyValue(token).trim();
       if(value&&CSS.supports('color',value))colors[key]=value;
     }
     iframe.contentWindow?.postMessage({type:'bb-android-theme',mode,colors},origin);
   };
   const ready=(event:MessageEvent)=>{
     if(event.source===iframe.contentWindow&&event.origin===origin&&event.data?.type==='bb-android-ready')publish();
   };
   const observer=new MutationObserver(publish);
   // Palette classes/variables can live on the app root or a scoped panel ancestor.
   for(let element:Element|null=iframe.parentElement;element;element=element.parentElement)
     observer.observe(element,{attributes:true});
   observer.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true});
   iframe.addEventListener('load',publish);
   document.addEventListener('load',publish,true);
   window.addEventListener('message',ready);
   media.addEventListener('change',publish);
   publish();
   return()=>{observer.disconnect();iframe.removeEventListener('load',publish);document.removeEventListener('load',publish,true);window.removeEventListener('message',ready);media.removeEventListener('change',publish);};
 },[url]);
 useEffect(()=>{
   const iframe=frame.current;if(!iframe||!url)return;
   const origin=new URL(url).origin;
   const publish=()=>iframe.contentWindow?.postMessage({type:'bb-android-language',language},origin);
   const ready=(event:MessageEvent)=>{if(event.source===iframe.contentWindow&&event.origin===origin&&event.data?.type==='bb-android-ready')publish();};
   iframe.addEventListener('load',publish);window.addEventListener('message',ready);publish();
   return()=>{iframe.removeEventListener('load',publish);window.removeEventListener('message',ready);};
 },[url,language]);
 useEffect(()=>{
   const iframe=frame.current;if(!iframe||!url)return;
   const origin=new URL(url).origin;let live=true;
   const copy=async(event:MessageEvent)=>{
     const data=event.data;
     if(event.source!==iframe.contentWindow||event.origin!==origin||data?.type!=='bb-android-copy'||!Number.isSafeInteger(data.id)||data.id<1||typeof data.text!=='string'||new TextEncoder().encode(data.text).length>65536)return;
     const ok=await experimental_copyToClipboard({text:data.text});
     if(live)iframe.contentWindow?.postMessage({type:'bb-android-copy-result',id:data.id,ok},origin);
   };
   window.addEventListener('message',copy);
   return()=>{live=false;window.removeEventListener('message',copy);};
 },[url]);
 if(!url)return <p role="status" style={{padding:16}}>{translate(language,error||'connecting')}</p>;
 return <iframe ref={frame} title="Android Emulator" src={url} style={{border:0,width:'100%',height:'100%',display:'block'}} allow="fullscreen" allowFullScreen/>;
}
export default definePluginApp(app=>{
 app.slots.threadPanelAction({id:'emulator',title:'Android Emulator',icon:'Smartphone',layout:'flush',component:Emulator});
 app.slots.navPanel({id:'android',title:'Android Emulator',icon:'Smartphone',path:'android',component:Emulator});
});
