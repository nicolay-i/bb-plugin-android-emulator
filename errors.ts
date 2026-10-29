// No imports: the panel bundle uses this, and it cannot load the server SDK that contract.ts needs.
const ERROR_KEYS = ['noSdk', 'noAdb', 'adbFailed', 'listFailed', 'unavailable', 'alreadyRunning', 'startFailed', 'unknownAvd',
  'notEmulator', 'portBusy', 'chooseAddress', 'hostOffline'];

/** Host errors carry an i18n key, optionally followed by `: detail`; anything else is a generic failure. */
export function hostError(message: string): { key: string; detail?: string } {
  // The earliest key wins, so words inside the detail never select another key.
  const found = ERROR_KEYS.map(key => ({ key, at: message.indexOf(key) })).filter(item => item.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!found) return { key: 'commandFailed' };
  const detail = message.slice(found.at + found.key.length).match(/^: (.+)/s)?.[1];
  return detail ? { key: found.key, detail } : { key: found.key };
}
