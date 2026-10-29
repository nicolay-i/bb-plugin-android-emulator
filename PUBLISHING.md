# Подготовка к BB Store

Статус: репозиторий публичный, тег `v0.1.3` на `main`. Плагин в BB Store
(get-bb/marketplace#675 принят, диапазон `^0.1.1`: выпуски 0.1.x Store берёт сам). Дальнейшая
работа — ветка `host-entry-scrcpy`, план — [ROADMAP.md](ROADMAP.md).

## Архитектура первого выпуска

Host entry (bb host worker) + scrcpy-server 3.3.3, вшитый в пакет. Просмотр в
браузере: WebCodecs H.264. Хост выбирается из списка, один активный поток на
хост. Транспорты: сеть BB (`bb connect`, wss) и LAN/VPN (`ws://`). Хосты:
Windows и Linux; macOS позже. Плагин только проверяет SDK/ADB/emulator/accel/AVD.

## Проверено

- Unit-тесты (протокол, парсеры, SDK, адреса), i18n 12 языков, typecheck, сборка.
- Харнесс без bb на Windows-хосте, исходники и собранный `dist/host.js` под
  Node: проверки окружения, запуск AVD, повторный запуск отклонён, первый кадр
  < 300 мс, ввод, Unicode-вставка, clipboard, кнопки, Origin/токен, остановка,
  смерть эмулятора освобождает endpoint и lease.

- Живой тест в BB 0.46.1 (headless Chromium на macOS-хосте, LAN/VPN через Tailscale до
  Windows-хоста): видео, тач, системные кнопки, меню хостов/устройств, ввод текста,
  проверки окружения на хосте без SDK, иконки; CLI `hosts`, `list`, `key`, `paste`.
- Linux-хост (Mint 20.3, KVM): `bb android-emulator start` загружает AVD, проверки
  окружения проходят; панель там не проверялась.
- Entry, overview и скриншоты проходят схему v2 и CI marketplace (PR #675).

## Осталось

1. Живой тест сети BB с getbb.app в обычном браузере (ROADMAP, пункт 3).
2. Панель на Linux-хосте.
3. Установка из Git на чистую машину: `bb plugin install git:…`.
4. После ревью PR #675 — правки по замечаниям мейнтейнеров.
5. Следующий релиз: `npm run check`, `npm test`, сборка, тег, обновление entry.

## Известные ограничения

- `bb plugin build` на Windows (bb 0.46.1): нужен `NODE_PATH="$(npm root -g)"`.
- LAN/VPN без TLS — только доверенные сети.

Источники:
- https://github.com/get-bb/marketplace/blob/main/README.md
- https://github.com/get-bb/marketplace/blob/main/schema/marketplace-v2.schema.json
- https://github.com/get-bb/marketplace/blob/main/icons/README.md
