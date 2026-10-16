/** scrcpy's key injection cannot type every Unicode character; paste those instead. */
export function unicodeKey(event) {
  if (event.isComposing || !event.key || !/[^\x00-\x7f]/u.test(event.key)) return false;
  return Boolean(!event.metaKey && (!(event.ctrlKey || event.altKey) || event.getModifierState?.('AltGraph')));
}

export function attachUnicodeInput(target, send, report) {
  let composing = false;
  let pending = Promise.resolve();
  let disposed = false;
  let queued = 0;
  let replaying = false;
  const consumed = new Set();
  const enqueue = task => {
    queued++;
    pending = pending.then(() => disposed ? undefined : task()).catch(report).finally(() => queued--);
  };
  const replay = event => {
    const target = event.target;
    const copy = new KeyboardEvent(event.type, {
      key:event.key, code:event.code, location:event.location, repeat:event.repeat,
      ctrlKey:event.ctrlKey, altKey:event.altKey, shiftKey:event.shiftKey, metaKey:event.metaKey,
      bubbles:true, cancelable:true, composed:true,
    });
    enqueue(() => {
      replaying = true;
      try { target.dispatchEvent(copy); } finally { replaying = false; }
    });
    event.preventDefault();event.stopImmediatePropagation();
  };
  const keydown = event => {
    if (replaying) return;
    if (composing || event.isComposing) { event.stopImmediatePropagation(); return; }
    const plain = event.key && Array.from(event.key).length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (!unicodeKey(event) && !(queued && plain)) {
      if (queued) replay(event);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    consumed.add(event.code || event.key);
    enqueue(() => send(event.key));
  };
  const keyup = event => {
    if (replaying) return;
    const id = event.code || event.key;
    if (composing || event.isComposing || consumed.delete(id)) {
      event.preventDefault();event.stopImmediatePropagation();
    } else if (queued) replay(event);
  };
  const start = event => { composing = true; event.stopImmediatePropagation(); };
  const end = event => {
    composing = false;
    event.stopImmediatePropagation();
    if (event.data) enqueue(() => send(event.data));
  };
  target.addEventListener('keydown', keydown, true);
  target.addEventListener('keyup', keyup, true);
  target.addEventListener('compositionstart', start, true);
  target.addEventListener('compositionend', end, true);
  return () => {
    disposed = true;
    target.removeEventListener('keydown', keydown, true);
    target.removeEventListener('keyup', keyup, true);
    target.removeEventListener('compositionstart', start, true);
    target.removeEventListener('compositionend', end, true);
  };
}
