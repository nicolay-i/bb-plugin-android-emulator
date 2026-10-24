# Подготовка к BB Store

Статус: репозиторий приватный, ветка `host-entry-scrcpy`. Публичного релиза,
тега и заявки в marketplace нет. Релиз и подача — только после согласования.

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
- Черновик marketplace entry, overview и пять скриншотов 1280 px проходят схему v2
  (локально, `.tmp/marketplace`).

## До публичного релиза

1. Живой тест сети BB с getbb.app в обычном браузере.
2. Linux-хост (KVM) — тот же сценарий.
3. Установка из Git на чистую машину: `bb plugin install git:…`.
4. Локально перед релизом: `npm run check`, `npm test`, сборка — на Windows и Linux.
5. Скриншоты: готовы в черновике; при желании заменить снятыми в обычном браузере (выше 577 px).
6. Публичный репозиторий, тег `v0.1.1`, entry в marketplace с `PLUGIN_OVERVIEW.md`.

## Известные ограничения

- `bb plugin build` на Windows (bb 0.46.1): нужен `NODE_PATH="$(npm root -g)"`.
- LAN/VPN без TLS — только доверенные сети.

Источники:
- https://github.com/get-bb/marketplace/blob/main/README.md
- https://github.com/get-bb/marketplace/blob/main/schema/marketplace-v2.schema.json
- https://github.com/get-bb/marketplace/blob/main/icons/README.md
