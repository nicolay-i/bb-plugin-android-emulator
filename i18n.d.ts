export const languageNames: Record<string,string>;
export const languageOptions: string[];
export const messages: Record<string,Record<string,string>>;
export function resolveLanguage(preference?:string,languages?:readonly string[]):string;
export function translate(language:string,key:string,values?:Record<string,string>):string;
