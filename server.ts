import { type BbPluginApi, defineCli, cliCommand } from '@get-bb/plugin-sdk';
import { hostContract, keyName, rpcContract, viewerAddress } from './contract.js';
import { languageOptions } from './i18n.js';

const TRANSPORTS = { 'BB network (bb connect)': 'bb', 'LAN / VPN': 'network' } as const;
type TransportLabel = keyof typeof TRANSPORTS;
const HOST_KEY = 'hostId';

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    language: { type: 'select', label: 'Language', options: languageOptions, default: 'Auto / Browser' },
    transport: {
      type: 'select', label: 'Connection', options: Object.keys(TRANSPORTS), default: 'BB network (bb connect)',
      description: 'BB network streams through bb connect and needs bb opened at getbb.app. LAN / VPN connects the browser straight to the Android host.',
    },
    networkAddress: {
      type: 'string', label: 'LAN / VPN addresses of Android hosts', default: '',
      description: 'IPv4 addresses the viewer listens on, comma-separated, one per Android host; each host uses the one it owns. A host with exactly one LAN or VPN address needs none.',
    },
    port: { type: 'number', label: 'Viewer port on the Android host', default: 6090 },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const config = async () => {
    const values = await settings.get();
    return { ...values, transport: TRANSPORTS[values.transport as TransportLabel] ?? 'bb' };
  };

  async function hosts() {
    const list = await bb.sdk.hosts.list();
    return list.map(item => ({ id: item.id, name: item.name, online: item.status === 'connected' }));
  }

  async function viewerUrl(hostId: string, port: number, token: string, transport: 'bb' | 'network', address: string) {
    if (transport === 'bb') {
      bb.hosts.declareSharedPorts(hostId, [port]);
      const tunnel = await bb.hosts.ensureSharedPortTunnel(hostId);
      return `wss://${tunnel.label}--${port}.${tunnel.baseDomain}/ws?token=${token}`;
    }
    return `ws://${address}:${port}/ws?token=${token}`;
  }

  bb.rpc.register(rpcContract, {
    config: async () => {
      const { language, transport } = await config();
      return { language, transport, hostId: (await bb.storage.kv.get<string>(HOST_KEY)) ?? null };
    },
    hosts,
    select: async ({ hostId }) => { await bb.storage.kv.set(HOST_KEY, hostId); return null; },
    state: ({ hostId }) => host.call('state', null, { hostId }),
    start: ({ hostId, avd }) => host.call('start', { avd }, { hostId }),
    stop: ({ hostId, serial }) => host.call('stop', { serial }, { hostId }),
    open: async ({ hostId, serial, origin }) => {
      const { transport, networkAddress: configured, port } = await config();
      const state = await host.call('state', null, { hostId });
      const address = transport === 'network' ? viewerAddress(state.addresses, configured) : 'loopback';
      const opened = await host.call('open', { serial, listen: { bind: address, port, origin } }, { hostId });
      return { url: await viewerUrl(hostId, opened.port, opened.token, transport, address) };
    },
    close: async ({ hostId }) => {
      await host.call('close', null, { hostId });
      bb.hosts.declareSharedPorts(hostId, []);
      return null;
    },
  });

  /** CLI target: `--host` (name or id) or the host last chosen in the panel. */
  async function resolveHost(requested: string | undefined): Promise<string> {
    const wanted = requested ?? (await bb.storage.kv.get<string>(HOST_KEY));
    if (!wanted) throw new Error('Choose a host with --host or in the Android Emulator panel.');
    const match = (await hosts()).find(item => item.id === wanted || item.name === wanted);
    if (!match) throw new Error(`Unknown host: ${wanted}`);
    return match.id;
  }
  async function activeSerial(hostId: string, requested: string | undefined): Promise<string> {
    if (requested) return requested;
    const state = await host.call('state', null, { hostId });
    const ready = state.devices.filter(device => device.state === 'device');
    const serial = state.active ?? (ready.length === 1 ? ready[0].serial : null);
    if (!serial) throw new Error('Pass --serial: several or no devices are running.');
    return serial;
  }

  const json = { type: 'boolean' as const, description: 'JSON output' };
  const hostOption = { type: 'string' as const, description: 'bb host name or id (default: the host chosen in the panel)' };
  const serialOption = { type: 'string' as const, description: 'Device serial, e.g. emulator-5554 (default: the active device)' };
  const done = (value: unknown, asJson: boolean | undefined, text: string) => ({ exitCode: 0, stdout: asJson ? JSON.stringify(value) : text });

  bb.cli.register(defineCli({ name: 'android-emulator', summary: 'Android emulators on bb hosts', commands: {
    hosts: cliCommand({ summary: 'bb hosts available for Android', options: { json }, run: async input => {
      const list = await hosts();
      return done(list, input.options.json, list.map(item => `${item.name}\t${item.id}\t${item.online ? 'online' : 'offline'}`).join('\n'));
    } }),
    list: cliCommand({ summary: 'Environment checks, AVDs and running devices', options: { host: hostOption, json }, run: async (input, ctx) => {
      const state = await host.call('state', null, { hostId: await resolveHost(input.options.host), signal: ctx.signal });
      const text = [
        ...state.checks.map(check => `${check.ok ? 'ok  ' : 'FAIL'} ${check.id}: ${check.detail}`),
        `avds: ${state.avds.join(', ') || '-'}`,
        ...state.devices.map(device => `device ${device.serial} ${device.state}${device.avd ? ` (${device.avd})` : ''}${device.serial === state.active ? ' [active]' : ''}`),
      ].join('\n');
      return done(state, input.options.json, text);
    } }),
    start: cliCommand({ summary: 'Start an AVD without a window; it keeps running after the panel closes',
      positionals: [{ name: 'avd', description: 'AVD name from list', required: true }], options: { host: hostOption, json },
      run: async (input, ctx) => {
        const result = await host.call('start', { avd: input.positionals.avd }, { hostId: await resolveHost(input.options.host), signal: ctx.signal });
        return done(result, input.options.json, `Starting ${input.positionals.avd}. Log: ${result.log}`);
      } }),
    stop: cliCommand({ summary: 'Shut down an emulator; unsaved state may be lost',
      positionals: [{ name: 'serial', description: 'Serial from list', required: true }], options: { host: hostOption, json },
      run: async (input, ctx) => {
        await host.call('stop', { serial: input.positionals.serial }, { hostId: await resolveHost(input.options.host), signal: ctx.signal });
        return done(null, input.options.json, `Stopped ${input.positionals.serial}`);
      } }),
    key: cliCommand({ summary: 'Press an Android system button',
      options: { key: { type: 'enum', values: keyName.options, required: true, description: 'back, home or recent' }, serial: serialOption, host: hostOption, json },
      run: async (input, ctx) => {
        const hostId = await resolveHost(input.options.host);
        const serial = await activeSerial(hostId, input.options.serial);
        await host.call('key', { serial, key: input.options.key }, { hostId, signal: ctx.signal });
        return done(null, input.options.json, `Pressed ${input.options.key} on ${serial}`);
      } }),
    paste: cliCommand({ summary: 'Paste text into the focused field (do not pass secrets through the CLI)',
      positionals: [{ name: 'text', description: 'Text up to 64 KB', required: true }], options: { serial: serialOption, host: hostOption, json },
      run: async (input, ctx) => {
        const hostId = await resolveHost(input.options.host);
        const serial = await activeSerial(hostId, input.options.serial);
        await host.call('paste', { serial, text: input.positionals.text }, { hostId, signal: ctx.signal });
        return done(null, input.options.json, `Pasted ${input.positionals.text.length} characters on ${serial}`);
      } }),
  } }));
}
