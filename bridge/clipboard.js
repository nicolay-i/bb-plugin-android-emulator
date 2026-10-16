let sequence = 0;

/** BB uses its native clipboard writer; standalone pages use the browser API. */
export async function copyToComputer(text, browser = window, timeoutMs = 5000) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 65536) return false;
  if (browser.parent === browser) {
    try { await browser.navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }
  return new Promise(resolve => {
    const id = ++sequence;
    const finish = ok => {
      clearTimeout(timer);
      browser.removeEventListener('message', receive);
      resolve(ok);
    };
    const receive = event => {
      if (event.source === browser.parent && event.data?.type === 'bb-android-copy-result' && event.data.id === id)
        finish(event.data.ok === true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    browser.addEventListener('message', receive);
    // Only the containing BB page receives the explicitly requested clipboard text.
    try { browser.parent.postMessage({type:'bb-android-copy', id, text}, '*'); }
    catch { finish(false); }
  });
}
