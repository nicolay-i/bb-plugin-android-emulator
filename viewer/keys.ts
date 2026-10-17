import type { ViewerMessage } from '../contract.js';

/** Android KEYCODE_* for keys that do not produce text. */
const SPECIAL: Record<string, number> = {
  Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 111,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
  Home: 122, End: 123, PageUp: 92, PageDown: 93,
};
const META_SHIFT = 1, META_CTRL = 0x1000;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Maps a browser key event to a viewer message. ASCII uses scrcpy text injection;
 * other text (Cyrillic, emoji, IME) goes through the Android clipboard, which types any Unicode.
 * Returns null for keys the viewer leaves to the browser.
 */
export function keyMessage(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>): ViewerMessage | null {
  if (event.isComposing || event.metaKey) return null;
  const code = SPECIAL[event.key];
  if (code !== undefined) return { t: 'code', code, meta: (event.shiftKey ? META_SHIFT : 0) | (event.ctrlKey ? META_CTRL : 0) };
  if (event.ctrlKey && !event.altKey) {
    // Ctrl+A/C/X/Z reach Android; Ctrl+V stays with the browser so its paste event carries computer text.
    const letter = /^[acxz]$/i.test(event.key) ? event.key.toUpperCase().charCodeAt(0) - 65 + 29 : null;
    return letter === null ? null : { t: 'code', code: letter, meta: META_CTRL };
  }
  if ([...event.key].length !== 1) return null;
  return PRINTABLE_ASCII.test(event.key) ? { t: 'text', text: event.key } : { t: 'paste', text: event.key };
}

/** IME results and pasted browser text. */
export function textMessage(text: string): ViewerMessage | null {
  if (!text) return null;
  return PRINTABLE_ASCII.test(text) && text.length <= 300 ? { t: 'text', text } : { t: 'paste', text: text.slice(0, 65536) };
}
