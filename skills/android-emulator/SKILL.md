---
name: android-emulator
description: Открыть экран Android в BB, выбрать или вручную запустить AVD, отправить текст и системные кнопки через bb android-emulator.
---
Панель: в правой панели треда нажмите «+» → Android Emulator.
Отдельная страница: Android Emulator в навигации BB.
Нужны работающий bridge на Android-машине и Tailscale на устройстве пользователя.

Команды работают на настроенной машине через HTTPS Tailscale, независимо от машины треда:
- `bb android-emulator list --json` — устройства, AVD и выбранный serial.
- `bb android-emulator select emulator-5554 --json` — общий экран всех зрителей.
- `bb android-emulator start bb_api34 --json` — ручной запуск AVD. Самостоятельно не останавливается.
- `bb android-emulator stop emulator-5554 --json` — выключить выбранный эмулятор; выполнять по явной просьбе пользователя, несохранённое состояние может потеряться.
- `bb android-emulator key --key back|home|recent --json`.
- `bb android-emulator paste 'Текст' --json` — в активное поле. Не передавать секреты через CLI: аргументы видны в истории. Пользователь отправляет их через поле панели.

Полное управление агентом уже доступно через ADB на Android-машине:
`adb -s SERIAL shell input tap X Y`, `input swipe X1 Y1 X2 Y2 MS`,
`exec-out screencap -p`, `shell uiautomator dump`, `logcat`.
Не выполняйте ADB локально, если SDK находится на другой машине: используйте её терминал/SSH.

Настройка: `bb plugin config android-emulator set viewerUrl https://MACHINE.tailNET.ts.net`.
Плагин не скачивает SDK и не меняет Tailscale Serve автоматически.

Граница настройки плагина: подключение к готовой Android-среде и трансляция.
Проверяйте SDK/ADB, Emulator, существующий AVD и компоненты bridge на Android-хосте.
Если чего-то нет, сообщите, что нужно подготовить. Установка SDK/образов/KVM,
создание AVD и изменение его конфигурации не входят в настройку плагина.
Ручной запуск уже созданного AVD поддерживается существующей командой start.
