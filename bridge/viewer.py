"""Local Android bridge. Expose with Tailscale Serve, never on a public interface."""
import atexit
import json
import os
import re
import subprocess
import threading
import signal
from pathlib import Path
from urllib.parse import urlsplit
from websockify.websocketproxy import ProxyRequestHandler, LibProxyServer

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('ANDROID_SDK_ROOT', str(Path.home() / 'Android/Sdk')))
ORIGIN = os.environ.get('ANDROID_VIEWER_ORIGIN', 'http://127.0.0.1:6087')
SCRCPY = os.environ.get('SCRCPY', str(ROOT / 'scrcpy-linux-x86_64-v5.0.1/scrcpy'))
KEYS = {'back': '4', 'home': '3', 'recent': '187'}


def run(args, **kwargs):
    return subprocess.check_output(args, timeout=10, stderr=subprocess.DEVNULL, **kwargs).decode().strip()


class Android:
    def __init__(self):
        self.lock = threading.RLock()
        self.serial = None
        self.scrcpy = None

    def adb(self, *args, serial=None):
        target = serial or self.serial
        return run([str(SDK / 'platform-tools/adb'), *(['-s', target] if target else []), *args])

    def state(self):
        devices = []
        for line in self.adb('devices').splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and re.fullmatch(r'emulator-\d+', parts[0]):
                name = parts[0]
                if parts[1] == 'device':
                    try:
                        lines = self.adb('emu', 'avd', 'name', serial=parts[0]).splitlines()
                        name = lines[0] if lines else name
                    except subprocess.SubprocessError:
                        pass
                devices.append({'serial': parts[0], 'name': name, 'status': parts[1]})
        avds = run([str(SDK / 'emulator/emulator'), '-list-avds']).splitlines()
        return {'devices': devices[:100], 'avds': avds[:100], 'selected': self.serial}

    def select(self, serial):
        with self.lock:
            if not any(d['serial'] == serial and d['status'] == 'device' for d in self.state()['devices']):
                raise ValueError('Эмулятор недоступен. Обновите список.')
            if self.serial == serial and self.scrcpy and self.scrcpy.poll() is None:
                return
            self.close()
            with (ROOT / 'scrcpy.log').open('ab') as log:
                self.scrcpy = subprocess.Popen([SCRCPY, '-s', serial, '--no-audio', '--max-size=1280',
                    '--max-fps=20', '--video-bit-rate=2M', '--window-borderless', '--window-width=432',
                    '--window-height=960', '--window-x=0', '--window-y=0', '--render-driver=software'],
                    stdout=log, stderr=log)
            self.serial = serial

    def close(self):
        if self.scrcpy and self.scrcpy.poll() is None:
            self.scrcpy.terminate()
            try:
                self.scrcpy.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.scrcpy.kill()
                self.scrcpy.wait()
        self.serial = None

    def start(self, avd):
        with self.lock:
            state = self.state()
            if avd not in state['avds']:
                raise ValueError('Неизвестный AVD.')
            if any(d['name'] == avd for d in state['devices']):
                raise ValueError('Этот AVD уже запущен.')
            used = {int(d['serial'].split('-')[1]) for d in state['devices']}
            port = next((n for n in range(5554, 5683, 2) if n not in used), None)
            if port is None:
                raise ValueError('Нет свободного порта эмулятора.')
            # Explicitly launched AVDs remain running when the viewer/plugin closes.
            with (ROOT / 'emulator-launch.log').open('ab') as log:
                proc = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', avd, '-port', str(port),
                    '-accel', 'on', '-gpu', 'swiftshader', '-memory', '2048', '-cores', '2',
                    '-no-window', '-no-audio', '-no-snapshot', '-no-boot-anim'],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            try:
                proc.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                return {'serial': f'emulator-{port}', 'starting': True}
            raise ValueError('Эмулятор не запустился. Проверьте emulator-launch.log.')

    def control(self, action, body):
        with self.lock:
            if action == 'start':
                return self.start(body.get('avd'))
            if action == 'select':
                self.select(body.get('serial'))
                return {'selected': self.serial}
            if not self.serial:
                raise ValueError('Сначала выберите работающий эмулятор.')
            if action == 'stop':
                target = body.get('serial')
                if (not isinstance(target, str) or not re.fullmatch(r'emulator-\d+', target)
                        or target != self.serial
                        or not any(d['serial'] == target and d['status'] == 'device' for d in self.state()['devices'])):
                    raise ValueError('Эмулятор недоступен. Обновите список.')
                self.adb('emu', 'kill', serial=target)
                try:
                    self.adb('wait-for-disconnect', serial=target)
                finally:
                    self.close()
                return {'stopped': target}
            if action == 'key' and body.get('key') in KEYS:
                self.adb('shell', 'input', 'keyevent', KEYS[body['key']])
            elif action == 'clipboard':
                try:
                    text = subprocess.check_output(['xclip', '-selection', 'clipboard', '-out', '-target', 'UTF8_STRING'], timeout=5, stderr=subprocess.DEVNULL).decode('utf-8')
                except subprocess.CalledProcessError:
                    text = ''  # Empty or non-text clipboard selection.
                if len(text.encode('utf-8')) > 65536:
                    raise ValueError('Слишком большой запрос.')
                return {'text': text}
            elif action == 'paste':
                text = body.get('text')
                if not isinstance(text, str) or not text or len(text.encode('utf-8')) > 65536:
                    raise ValueError('Нужен текст размером от 1 до 65536 байт.')
                subprocess.run(['xclip', '-selection', 'clipboard', '-in'], input=text.encode(),
                    check=True, timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                subprocess.run(['xdotool', 'key', '--clearmodifiers', 'ctrl+v'],
                    check=True, timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                raise ValueError('Неизвестная команда.')
            return {'ok': True}


android = Android()


class PanelHandler(ProxyRequestHandler):
    def end_headers(self):
        # Only static modules need CORS for the legacy BB file preview.
        if not urlsplit(self.path).path.startswith('/api/'):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def reply(self, code, value):
        content = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/state':
            try:
                self.reply(200, android.state())
            except (OSError, subprocess.SubprocessError):
                self.reply(502, {'error': 'Не удалось получить список. Проверьте Android SDK.', 'code':'listFailed'})
        elif path in ('/', '/android.html', '/i18n.js', '/text-input.js', '/clipboard.js'):
            content = (ROOT / (path[1:] if path in ('/i18n.js', '/text-input.js', '/clipboard.js') else 'android.html')).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', ('text/javascript' if path.endswith('.js') else 'text/html') + '; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()

    def do_POST(self):
        if (self.headers.get('Origin') != ORIGIN or
                self.headers.get('X-Android-Control') != '1'):
            self.reply(403, {'error': 'Недопустимый источник команды.', 'code':'sourceDenied'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 400000:
                self.reply(413, {'error': 'Слишком большой запрос.', 'code':'tooLarge'})
                return
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('Нужен объект JSON.')
            action = {'/api/key':'key', '/api/paste':'paste', '/api/start':'start', '/api/stop':'stop', '/api/select':'select', '/api/clipboard':'clipboard'}.get(self.path)
            self.reply(200, android.control(action, body))
        except (ValueError, UnicodeDecodeError) as error:
            self.reply(400, {'error': str(error), 'code': {'Эмулятор недоступен. Обновите список.': 'unavailable', 'Неизвестный AVD.': 'unknownAvd', 'Этот AVD уже запущен.': 'alreadyRunning', 'Нет свободного порта эмулятора.': 'noPort', 'Эмулятор не запустился. Проверьте emulator-launch.log.': 'startFailed', 'Сначала выберите работающий эмулятор.': 'selectFirst', 'Нужен текст размером от 1 до 65536 байт.': 'invalidText', 'Неизвестная команда.': 'unknownCommand', 'Слишком большой запрос.': 'tooLarge'}.get(str(error), 'invalid')})
        except (OSError, subprocess.SubprocessError):
            self.reply(502, {'error': 'Команда не выполнена. Проверьте подключение эмулятора.', 'code':'commandFailed'})


if __name__ == '__main__':
    devices = android.state()['devices']
    first = next((d for d in devices if d['status'] == 'device'), None)
    if first:
        android.select(first['serial'])
    atexit.register(android.close)
    signal.signal(signal.SIGTERM, lambda *_: exit(0))
    # Websockify forks per client by default, which would split selected-device state.
    # Use its supported threaded server so every client shares this controller.
    LibProxyServer(RequestHandlerClass=PanelHandler, listen_host='127.0.0.1',
        listen_port=6087, target_host='127.0.0.1', target_port=5907,
        web='/usr/share/novnc', run_once=False).serve_forever()
