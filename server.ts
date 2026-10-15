import { type BbPluginApi, defineCli, cliCommand } from '@get-bb/plugin-sdk';
import { command, rpcContract } from './contract.js';
import { languageOptions } from './bridge/i18n.js';
export default async function plugin(bb:BbPluginApi){
  const settings=bb.settings.define({
    language:{type:'select',label:'Language / Язык',options:languageOptions,default:'Auto / Browser'},
    viewerUrl:{type:'string',label:'Android bridge HTTPS URL (Tailscale)',default:''},
  });
  bb.rpc.register(rpcContract,{config:async()=>{const {viewerUrl,language}=await settings.get();return {viewerUrl,language};}});
  const json={type:'boolean' as const,description:'Вывести JSON'};
  const control=async(input:unknown,signal:AbortSignal|undefined)=>{
    const cfg=await settings.get();
    if(!cfg.viewerUrl)throw new Error('Задайте viewerUrl в настройках Android Emulator.');
    const url=new URL(cfg.viewerUrl);
    if(url.protocol!=='https:')throw new Error('viewerUrl должен использовать HTTPS.');
    const {action,...body}=command.parse(input);
    const response=await fetch(new URL('/api/'+action,url),{
      ...(action==='state'?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Android-Control':'1',Origin:url.origin},body:JSON.stringify(body)}),
      redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||`Bridge HTTP ${response.status}`);
    return {exitCode:0,stdout:JSON.stringify(result)};
  };
  bb.cli.register(defineCli({name:'android-emulator',summary:'Выбор и управление Android-эмулятором',commands:{
    list:cliCommand({summary:'Работающие эмуляторы и доступные AVD',options:{json},run:(_,ctx)=>control({action:'state'},ctx.signal)}),
    select:cliCommand({summary:'Подключить экран к эмулятору (общий для всех зрителей)',positionals:[{name:'serial',description:'Например emulator-5554',required:true}],options:{json},run:(input,ctx)=>control({action:'select',serial:input.positionals.serial},ctx.signal)}),
    start:cliCommand({summary:'Запустить AVD вручную; остаётся работать после закрытия панели',positionals:[{name:'avd',description:'Имя AVD из list',required:true}],options:{json},run:(input,ctx)=>control({action:'start',avd:input.positionals.avd},ctx.signal)}),
    key:cliCommand({summary:'Системная кнопка Android',options:{key:{type:'enum',values:['back','home','recent'],required:true,description:'Кнопка Android'},json},run:(input,ctx)=>control({action:'key',key:input.options.key},ctx.signal)}),
    paste:cliCommand({summary:'Вставить текст в выбранное поле (не передавайте секреты через CLI)',positionals:[{name:'text',description:'Текст до 64 КБ',required:true}],options:{json},run:(input,ctx)=>control({action:'paste',text:input.positionals.text},ctx.signal)}),
  }}));
}
