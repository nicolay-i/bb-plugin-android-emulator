import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
export const command = z.discriminatedUnion('action', [
  z.object({action:z.literal('state')}).strict(),
  z.object({action:z.literal('select'),serial:z.string().regex(/^emulator-\d+$/)}).strict(),
  z.object({action:z.literal('start'),avd:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal('key'),key:z.enum(['back','home','recent'])}).strict(),
  z.object({action:z.literal('paste'),text:z.string().min(1).max(65536)}).strict(),
]);
export const rpcContract = defineRpcContract({
  config:{input:z.null(),output:z.object({viewerUrl:z.string(),language:z.string()})},
});
