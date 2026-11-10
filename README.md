# NEZER LAUNCHER

**NEZER LAUNCHER** — независимый лаунчер Minecraft Java Edition для Windows, созданный на Electron, React и TypeScript. Интерфейс на русском языке.

## Возможности

- Фиолетовое оформление, пользовательский фон, анимированный снегопад, настройка акцентного цвета.
- Главная страница, каталог версий Minecraft, Fabric, моды, сборки, аккаунты, скины, настройки.
- Загрузка Minecraft через minecraft-launcher-core и автоматическая установка подходящей Java через Eclipse Adoptium.
- Поиск модов и модпаков через Modrinth.
- Локальный профиль по никнейму и необязательная авторизация Microsoft.
- Обновление установленного Windows-приложения через GitHub Releases (electron-updater).

### Ограничения

Локальный профиль **не подтверждает владение Minecraft** и не даёт доступ на серверы, которые требуют лицензию. Каталог сборок пока открывает модпаки на Modrinth без автоматического импорта `.mrpack`. Раздел скинов показывает локальные PNG, но не изменяет скин Microsoft-аккаунта. Проект пока проходит проверку сборки на Windows; не считайте непроверенные функции гарантированно рабочими.

## Запуск исходников

Требуются **Node.js 22**, Windows 10/11 x64 и подключение к интернету при первой установке.

```powershell
npm install
npm run dev
```

Или запустите `START-LAUNCHER.bat`. Для локальной сборки установщика:

```powershell
npm install
npm run dist:win
```

Созданный установщик будет в `release/`.

## Автообновления — GitHub Releases

Репозиторий: https://github.com/nurixde/nezer-launcher

В репозитории настроен workflow `.github/workflows/release.yml`. При изменении версии в `package.json` workflow собирает Windows NSIS-установщик и публикует выпуск `v<версия>` с `latest.yml`. Можно также запускать workflow вручную через Actions.

**Для автоматического обновления нужно один раз установить именно NSIS `.exe` из успешного GitHub Release.** Запуск через `npm run dev` и `START-LAUNCHER.bat` автообновления не поддерживает. В установщике: Настройки → Проверить обновления → Скачать → Перезапустить и установить.

В Settings → Actions → General могут потребоваться права **Read and write permissions** для GITHUB_TOKEN. Готовый `.exe` пока не подписан сертификатом подписи кода; Windows может показать предупреждение об неизвестном издателе.

Не публикуйте пароли, токены, файлы `.env` и кэш авторизации.

## Проверки

Тесты: `npm test`. Компиляция: `npm run build`. Реальная сборка и первый GitHub Release должны завершиться успешно до того, как можно будет утверждать, что автообновление работает.

Minecraft является товарным знаком Mojang Studios. Приложение не связано с Mojang, Microsoft или Minecraft.


## Microsoft OAuth — independent app registration (experimental feature branch)

The existing device-code flow uses a legacy Minecraft title/client ID. Microsoft may decline the token request (`invalid_grant`) even when the browser says the user signed in successfully. Repeating an expired code does not resolve OAuth client restrictions.

To use an independent OAuth app, configure its **Application (client) ID** in **Настройки → Microsoft OAuth**. The ID must be a GUID, and the application must be registered as a public client in Microsoft Entra. The `msal` flow requires `XboxLive.signin` scope, and Minecraft Services may require official approval of the app ID. See [Microsoft OAuth device-code documentation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) and [Minecraft application ID guidance](https://help.minecraft.net/hc/en-us/articles/16254801392141).

Do not share Microsoft passwords, client secrets, access tokens, refresh tokens, or one-time login codes. A public client ID is not a secret. The app must follow Microsoft's sign-in policies; no bypass is implemented.

This feature is **not validated with a real Microsoft or Minecraft profile**. It remains in a separate branch until the project has an appropriately registered/approved client ID and the OAuth flow is tested end-to-end. The old stable GitHub Release remains unchanged.
