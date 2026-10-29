import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { definePluginApp, useRpc, experimental_copyToClipboard, experimental_saveFile, experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { HostState, ViewerMessage, rpcContract } from './contract';
import { hostError } from './errors';
import { resolveLanguage, translate } from './i18n.js';
import { keyMessage, textMessage } from './viewer/keys';
import { parsePacket, VideoPlayer } from './viewer/video';
import { styles } from './viewer/styles';

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Host = { id: string; name: string; online: boolean };
type Link = 'idle' | 'connecting' | 'live' | 'lost';
type Popover = 'host' | 'device' | 'launch' | 'input' | 'more' | 'clipboard' | 'stop' | null;

const RECONNECT_MS = [1000, 2000, 5000, 10000];

function Emulator() {
  const rpc = useRpc<typeof rpcContract>();
  const [language, setLanguage] = useState(() => resolveLanguage('auto', navigator.languages));
  const t = useCallback((key: string, values?: Record<string, string>) => translate(language, key, values), [language]);
  const [transport, setTransport] = useState<'bb' | 'network'>('bb');
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [state, setState] = useState<HostState | null>(null);
  const [serial, setSerial] = useState<string | null>(null);
  const [link, setLink] = useState<Link>('idle');
  // The device has shown a frame; until then the screen stays hidden instead of an empty black frame.
  const [seen, setSeen] = useState(false);
  const [status, setStatus] = useState('');
  const [popover, setPopover] = useState<Popover>(null);
  const [busy, setBusy] = useState(false);
  // The AVD the user just launched, until adb lists it; adb then reports it `offline` while it boots.
  const [launching, setLaunching] = useState<string | null>(null);
  const [deviceClipboard, setDeviceClipboard] = useState('');
  const [text, setText] = useState('');
  const [tick, setTick] = useState(0);
  const failures = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const describe = useCallback((error: unknown) => {
    const { key, detail } = hostError(String((error as Error)?.message ?? ''));
    return detail ? `${t(key)} ${detail}` : t(key);
  }, [t]);
  const report = useCallback((error: unknown) => setStatus(describe(error)), [describe]);
  // Why the host state cannot load (e.g. the host is offline); cleared by the next successful refresh.
  const [hostIssue, setHostIssue] = useState('');

  // Settings and host list.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [config, list] = await Promise.all([rpc.call('config', null), rpc.call('hosts', null)]);
        if (!live) return;
        setLanguage(resolveLanguage(config.language, navigator.languages));
        setTransport(config.transport);
        setHosts(list);
        setHostId(config.hostId && list.some(host => host.id === config.hostId) ? config.hostId : null);
      } catch (error) { if (live) report(error); }
    })();
    return () => { live = false; };
  }, [rpc, report]);

  const refresh = useCallback(async () => {
    if (!hostId) return;
    const next = await rpc.call('state', { hostId });
    setState(next);
    setLaunching(current => (current && next.devices.some(device => device.avd === current) ? null : current));
    setSerial(current => {
      const ready = next.devices.filter(device => device.state === 'device').map(device => device.serial);
      if (current && ready.includes(current)) return current;
      return next.active && ready.includes(next.active) ? next.active : ready[0] ?? null;
    });
  }, [rpc, hostId]);

  const poll = useCallback(() => refresh().then(() => setHostIssue(''), error => setHostIssue(describe(error))), [refresh, describe]);

  useEffect(() => {
    if (!hostId) return;
    setState(null);
    setHostIssue('');
    void poll();
    const timer = setInterval(() => { if (!document.hidden) void poll(); }, 5000);
    return () => clearInterval(timer);
  }, [hostId, poll]);

  useEffect(() => setSeen(false), [hostId, serial]);
  useEffect(() => setLaunching(null), [hostId]);

  // Video and control socket for the selected device.
  useEffect(() => {
    const target = canvas.current;
    // No running device: the empty screen explains it, so drop stale link errors.
    if (!hostId || !serial || !target) { setLink('idle'); setStatus(''); return; }
    if (typeof VideoDecoder === 'undefined') { setStatus(t('noWebCodecs')); return; }
    let live = true, retry: ReturnType<typeof setTimeout> | undefined;
    const player = new VideoPlayer(target, () => { if (live) socket.current?.close(); }, () => { if (live) { failures.current = 0; setLink('live'); setSeen(true); setStatus(''); } });
    setLink('connecting');
    void (async () => {
      try {
        const { url } = await rpc.call('open', { hostId, serial, origin: location.origin });
        if (!live) return;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        socket.current = ws;
        ws.onmessage = event => {
          if (typeof event.data !== 'string') { player.push(parsePacket(event.data)); return; }
          const message = JSON.parse(event.data);
          if (message.t === 'clipboard' && typeof message.text === 'string') setDeviceClipboard(message.text);
          else if (message.t === 'error') setStatus(t('commandFailed'));
        };
        ws.onclose = () => {
          if (!live) return;
          setLink('lost');
          setStatus(t(player.frames ? 'disconnected' : transport === 'network' ? 'networkBlocked' : 'bbBlocked'));
          retry = setTimeout(() => setTick(value => value + 1), RECONNECT_MS[Math.min(failures.current++, RECONNECT_MS.length - 1)]);
        };
      } catch (error) {
        if (!live) return;
        setLink('lost');
        report(error);
      }
    })();
    return () => { live = false; clearTimeout(retry); socket.current?.close(); socket.current = null; player.close(); };
  }, [rpc, hostId, serial, tick, transport, t, report]);

  const send = useCallback((message: ViewerMessage | null) => {
    if (message && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  const point = (event: { clientX: number; clientY: number }) => {
    const target = canvas.current!;
    const rect = target.getBoundingClientRect();
    return { x: Math.round((event.clientX - rect.left) / rect.width * target.width), y: Math.round((event.clientY - rect.top) / rect.height * target.height), w: target.width, h: target.height };
  };
  const touch = (action: 0 | 1 | 2) => (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvas.current?.width || (action === 2 && !event.buttons)) return;
    if (action === 0) { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }
    send({ t: 'touch', action, ...point(event) });
  };

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const wheel = (event: WheelEvent) => {
      if (!target.width) return;
      event.preventDefault();
      const clamp = (value: number) => Math.max(-16, Math.min(16, value));
      send({ t: 'scroll', ...point(event), dx: clamp(-event.deltaX / 100), dy: clamp(-event.deltaY / 100) });
    };
    const keydown = (event: KeyboardEvent) => {
      const message = keyMessage(event);
      if (!message) return;
      event.preventDefault();
      send(message);
    };
    const paste = (event: ClipboardEvent) => { event.preventDefault(); send(textMessage(event.clipboardData?.getData('text/plain') ?? '')); };
    const composition = (event: CompositionEvent) => send(textMessage(event.data));
    target.addEventListener('wheel', wheel, { passive: false });
    target.addEventListener('keydown', keydown);
    target.addEventListener('paste', paste);
    target.addEventListener('compositionend', composition);
    return () => {
      target.removeEventListener('wheel', wheel);
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('paste', paste);
      target.removeEventListener('compositionend', composition);
    };
  }, [send]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  async function chooseHost(id: string) {
    setPopover(null);
    setSerial(null);
    setHostId(id);
    await rpc.call('select', { hostId: id }).catch(report);
  }

  async function action(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setPopover(null);
    try { await work(); if (done) setStatus(t(done)); }
    catch (error) { report(error); }
    finally { setBusy(false); await poll(); }
  }

  const startAvd = (name: string) => {
    setLaunching(name);
    // An emulator that dies before adb lists it would leave the spinner forever.
    setTimeout(() => setLaunching(current => (current === name ? null : current)), 120_000);
    return action(() => rpc.call('start', { hostId: hostId!, avd: name }).catch(error => { setLaunching(null); throw error; }));
  };
  const stopDevice = () => {
    setPopover(null);
    if (serial) void action(() => rpc.call('stop', { hostId: hostId!, serial }), 'stopped');
  };

  function submitText(event: FormEvent) {
    event.preventDefault();
    if (!text) return;
    send({ t: 'paste', text });
    setText('');
    setPopover(null);
    setStatus(t('sent'));
    canvas.current?.focus();
  }

  async function screenshot() {
    const target = canvas.current;
    const blob = target && await new Promise<Blob | null>(resolve => target.toBlob(resolve, 'image/png'));
    if (!blob) { setStatus(t('waitImage')); return; }
    await experimental_saveFile({ fileName: `${serial}-${new Date().toISOString().replaceAll(':', '-')}.png`, blob });
  }

  async function copyClipboard() {
    setStatus(t((await experimental_copyToClipboard({ text: deviceClipboard })) ? 'copied' : 'copyManual'));
  }

  const host = hosts.find(item => item.id === hostId);
  const device = state?.devices.find(item => item.serial === serial);
  const failed = state?.checks.filter(check => !check.ok) ?? [];
  // AVDs that are not running yet; starting a running one fails with alreadyRunning.
  const idleAvds = state?.avds.filter(name => name !== launching && !state.devices.some(item => item.avd === name)) ?? [];
  const launchItems = idleAvds.map(name => (
    <button key={name} disabled={busy} onClick={() => void startAvd(name)}>{t('launchNamed', { name })}</button>
  ));
  const toggle = (name: Exclude<Popover, null>) => setPopover(current => (current === name ? null : name));
  const ready = Boolean(serial);
  const booting = Boolean(launching) || Boolean(state?.devices.some(device => device.serial.startsWith('emulator-') && device.state !== 'device'));

  return (
    <div className="bbae" onPointerDown={event => { if (!(event.target as Element).closest('.bbae-header')) setPopover(null); }}>
      <style>{styles}</style>
      <header className="bbae-header">
        <button className="bbae-chip" aria-expanded={popover === 'host'} onClick={() => toggle('host')} title={t('chooseHost')}>
          <Icon name="Laptop" aria-hidden />
          <span className="bbae-name">{host?.name ?? t('chooseHost')}</span>
        </button>
        {hostId && (
          <button className="bbae-chip" aria-expanded={popover === 'device' || popover === 'launch'} onClick={() => setPopover(current => (current === 'device' || current === 'launch' ? null : 'device'))} aria-label={device ? t('deviceNamed', { name: device.avd ?? device.serial }) : t('chooseDevice')}>
            <span className={`bbae-dot ${link === 'live' ? 'online' : ''}`} />
            <span className="bbae-name">{device ? device.avd ?? device.serial : t('none')}</span>
            <Icon name="ChevronDown" aria-hidden />
          </button>
        )}
        <span className="bbae-spacer" />
        {ready && <>
          <IconButton icon="android-emulator/camera" label={t('screenshot')} onClick={() => void screenshot()} />
          <IconButton icon="RotateCcw" label={t('rotate')} onClick={() => send({ t: 'rotate' })} />
          <IconButton icon="Keyboard" label={t('input')} expanded={popover === 'input'} onClick={() => toggle('input')} />
        </>}
        {hostId && <IconButton icon="MoreHorizontal" label={t('more')} expanded={popover === 'more' || popover === 'clipboard' || popover === 'stop'} onClick={() => toggle('more')} />}

        {popover === 'host' && (
          <section className="bbae-popover bbae-menu bbae-left" aria-label={t('chooseHost')}>
            {hosts.map(item => (
              <button key={item.id} disabled={!item.online} aria-current={item.id === hostId} onClick={() => void chooseHost(item.id)}>
                <span className={`bbae-dot ${item.online ? 'online' : ''}`} />{item.name}{!item.online && <span className="bbae-hint">{t('offline')}</span>}
              </button>
            ))}
          </section>
        )}
        {(popover === 'device' || popover === 'launch') && state && (
          <section className="bbae-popover bbae-menu bbae-left" aria-label={t('chooseDevice')}>
            {state.devices.length === 0 ? launchItems : <>
              <p className="bbae-label bbae-menu-title">{t('running')}</p>
              {state.devices.map(item => (
                <button key={item.serial} disabled={item.state !== 'device'} aria-current={item.serial === serial}
                  onClick={() => { setSerial(item.serial); setPopover(null); }}>
                  <span className={`bbae-dot ${item.state === 'device' ? 'online' : ''}`} />{item.avd ?? item.serial}
                  <span className="bbae-hint">{item.state === 'device' ? item.serial : item.state}</span>
                </button>
              ))}
              {idleAvds.length > 0 && <div className="bbae-submenu" onMouseEnter={() => setPopover('launch')} onMouseLeave={() => setPopover('device')}>
                <button aria-expanded={popover === 'launch'} onClick={() => toggle('launch')}>
                  {t('launch')}<span className="bbae-spacer" /><Icon name="ChevronRight" aria-hidden />
                </button>
                {popover === 'launch' && <div className="bbae-popover bbae-menu">{launchItems}</div>}
              </div>}
            </>}
            {state.avds.length === 0 && <p className="bbae-hint bbae-menu-title">{t('noAvds')}</p>}
          </section>
        )}
        {popover === 'input' && (
          <section className="bbae-popover" aria-label={t('input')}>
            <form onSubmit={submitText}>
              <label className="bbae-label" htmlFor="bbae-text">{t('textLabel')}</label>
              <textarea id="bbae-text" rows={3} autoFocus value={text} placeholder={t('placeholder')} onChange={event => setText(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitText(event); }} />
              <div className="bbae-row">
                <span className="bbae-hint">{t('shortcut')}</span><span className="bbae-spacer" />
                <button type="button" onClick={() => setPopover(null)}>{t('cancel')}</button>
                <button className="bbae-primary" type="submit" disabled={!text || link !== 'live'}>{t('send')}</button>
              </div>
            </form>
          </section>
        )}
        {popover === 'more' && (
          <div className="bbae-popover bbae-menu">
            <button onClick={() => { setPopover(null); void poll(); }}>{t('refresh')}</button>
            <button disabled={!ready} onClick={() => { setPopover(null); failures.current = 0; setTick(value => value + 1); }}>{t('reconnect')}</button>
            <button disabled={!ready} onClick={() => setPopover('clipboard')}>{t('clipboard')}</button>
            <button disabled={!serial?.startsWith('emulator-') || busy} onClick={() => setPopover('stop')}>{t('stop')}</button>
          </div>
        )}
        {popover === 'stop' && (
          <section className="bbae-popover" role="alertdialog" aria-label={t('stop')} aria-describedby="bbae-stop-text">
            <p id="bbae-stop-text" className="bbae-confirm">{t('stopConfirm', { name: device?.avd ?? serial ?? '' })}</p>
            <div className="bbae-row"><span className="bbae-spacer" />
              <button autoFocus onClick={() => setPopover(null)}>{t('cancel')}</button>
              <button className="bbae-primary bbae-danger" disabled={busy} onClick={stopDevice}>{t('stop')}</button>
            </div>
          </section>
        )}
        {popover === 'clipboard' && (
          <section className="bbae-popover" aria-label={t('clipboard')}>
            <label className="bbae-label" htmlFor="bbae-clipboard">{t('clipboardLabel')}</label>
            <p className="bbae-hint">{t('clipboardHelp')}</p>
            <textarea id="bbae-clipboard" rows={4} readOnly value={deviceClipboard} />
            <div className="bbae-row"><span className="bbae-spacer" />
              <button className="bbae-primary" disabled={!deviceClipboard} onClick={() => void copyClipboard()}>{t('copy')}</button>
            </div>
          </section>
        )}
      </header>

      <main className="bbae-stage">
        <canvas ref={canvas} tabIndex={0} hidden={!ready || !seen} aria-label={t('screen')} className="bbae-screen"
          onPointerDown={touch(0)} onPointerMove={touch(2)} onPointerUp={touch(1)} onPointerCancel={touch(1)} />
        {!ready && <Empty busy={booting}>
          {!hostId ? <><h1>{t('chooseHost')}</h1><p>{t('chooseHostBody')}</p>
            <button className="bbae-primary" onClick={() => toggle('host')}>{t('chooseHost')}</button></>
          : !state ? <p>{hostIssue || t('connecting')}</p>
          : failed.length > 0 ? <Checks state={state} t={t} />
          : booting ? <><h1>{t('starting')}</h1><p>{t('emptyBody')}</p></>
          : <><h1>{t('emptyTitle')}</h1>
            {idleAvds.length ? <div className="bbae-choices">{launchItems}</div> : <p>{t('noAvds')}</p>}</>}
        </Empty>}
        {ready && !seen && <Empty>{link !== 'lost' && <p>{t('connecting')}</p>}</Empty>}
      </main>
      {(state && hostIssue || status) && <p className="bbae-status" role="status" aria-live="polite">{state && hostIssue || status}</p>}
      {ready && (
        <nav className="bbae-nav" aria-label={t('nav')}>
          <div>
            <IconButton icon="android-emulator/back" label={t('back')} onClick={() => send({ t: 'key', key: 'back' })} />
            <IconButton icon="Circle" label={t('home')} onClick={() => send({ t: 'key', key: 'home' })} />
            <IconButton icon="Square" label={t('recent')} onClick={() => send({ t: 'key', key: 'recent' })} />
          </div>
        </nav>
      )}
    </div>
  );
}

function IconButton(props: { icon: string; label: string; onClick: () => void; expanded?: boolean }) {
  return (
    <button className="bbae-icon" aria-label={props.label} title={props.label} aria-expanded={props.expanded} onClick={props.onClick}>
      <Icon name={props.icon} aria-hidden />
    </button>
  );
}

function Empty({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return <section className="bbae-empty" aria-busy={busy}><div className="bbae-empty-icon">{busy ? <span className="bbae-spinner" /> : <Icon name="Smartphone" aria-hidden />}</div>{children}</section>;
}

/** Environment readiness: the plugin checks the Android setup but never installs or changes it. */
function Checks({ state, t }: { state: HostState; t: (key: string, values?: Record<string, string>) => string }) {
  return (
    <div className="bbae-checks">
      <h1>{t('checksTitle')}</h1>
      <ul>
        {state.checks.map(check => (
          <li key={check.id} className={check.ok ? 'ok' : 'fail'}>
            <Icon name={check.ok ? 'CircleCheck' : 'CircleX'} aria-hidden />
            <div><strong>{t(`check_${check.id}`)}</strong>{!check.ok && <p>{t(check.id === 'accel' ? `hint_accel_${state.platform === 'win32' ? 'win' : 'unix'}` : `hint_${check.id}`)}</p>}
              {check.detail && <code>{check.detail}</code>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** BB has no built-in camera or Android back glyph; both follow the host icon size and colour. */
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Settings: the LAN / VPN address list, one row per Android host. Rows read as text until edited. */
function Addresses() {
  const rpc = useRpc<typeof rpcContract>();
  const [list, setList] = useState<string[] | null>(null);
  // Row being edited; `list.length` is a new row.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { rpc.call('addresses', null).then(setList, cause => setError(String(cause?.message ?? cause))); }, [rpc]);

  async function save(next: string[]) {
    try { await rpc.call('setAddresses', { addresses: next }); setList(next); setEditing(null); setError(''); }
    catch (cause) { setError(String((cause as Error)?.message ?? cause)); }
  }
  function edit(index: number) { setEditing(index); setDraft(list?.[index] ?? ''); setError(''); }
  function commit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!IPV4.test(value)) { setError('Enter an IPv4 address, for example 100.64.0.1.'); return; }
    if (list!.some((address, index) => address === value && index !== editing)) { setError(`${value} is already in the list.`); return; }
    const next = [...list!];
    next[editing!] = value;
    void save(next);
  }

  if (!list) return <div className="bbae bbae-settings">{error && <p className="bbae-error" role="alert">{error}</p>}</div>;
  const rows = editing === list.length ? [...list, ''] : list;
  return (
    <div className="bbae bbae-settings">
      <p className="bbae-hint">The browser connects straight to the Android host when Connection is LAN / VPN. Add an address for every host that has several; each host uses the one it owns.</p>
      {rows.length > 0 && <ul className="bbae-addresses">
        {rows.map((address, index) => index === editing
          ? <li key={index}><form onSubmit={commit} onKeyDown={event => { if (event.key === 'Escape') setEditing(null); }}>
              <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="100.64.0.1" aria-label="IPv4 address" />
              <button type="submit" className="bbae-primary">Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </form></li>
          : <li key={index}><code>{address}</code>
              <button type="button" disabled={editing !== null} onClick={() => edit(index)}>Edit</button>
              <button type="button" disabled={editing !== null} onClick={() => void save(list.filter((_, at) => at !== index))}>Delete</button>
            </li>)}
      </ul>}
      {error && <p className="bbae-error" role="alert">{error}</p>}
      {editing === null && <button type="button" onClick={() => edit(list.length)}>+ Add address</button>}
    </div>
  );
}

const glyph = (path: string) => ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={path} />
  </svg>
);

export default definePluginApp(app => {
  app.experimental_icons.register({ name: 'android-emulator/camera', component: glyph('M4 8h3l2-3h6l2 3h3v11H4z M12 10.5a3 3 0 1 0 0 6 3 3 0 1 0 0-6z') });
  app.experimental_icons.register({ name: 'android-emulator/back', component: glyph('M17 5v14L6 12z') });
  app.slots.threadPanelAction({ id: 'emulator', title: 'Android Emulator', icon: 'Smartphone', layout: 'flush', component: Emulator });
  app.slots.settingsSection({ id: 'addresses', title: 'LAN / VPN addresses', component: () => <><style>{styles}</style><Addresses /></> });
  app.slots.navPanel({ id: 'android', title: 'Android Emulator', icon: 'Smartphone', path: 'android', component: Emulator });
});
