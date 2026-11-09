# NEZER LAUNCHER

Windows Minecraft Java Edition launcher (Electron + React + TypeScript).

## Status

GitHub integration confirmed. This repository is being prepared for the **v2.3.0** Windows release and GitHub Releases auto-updates.

**The full application source is not yet committed here.** Upload the *contents* of `NEZER-LAUNCHER-v2.3-GITHUB-UPDATES.zip` into the root of this repository, including hidden directory `.github`. Do not upload only the ZIP file.

## Release

Once source files (including `package.json`, `electron/`, `src/`, `index.html`) are committed:

1. In **Settings → Actions → General**, give workflows **Read and write permissions**.
2. Push a tag matching `package.json` version: `v2.3.0`.
3. Check **Actions** for build success and **Releases** for `.exe`, `latest.yml`, `.blockmap`.
4. Install the NSIS `.exe` from the successful release one time. Development launches from `START-LAUNCHER.bat` do not auto-update.
5. Future version bumps and tags will create releases for in-app updater, subject to successful builds.

No secrets or Microsoft credentials should be uploaded to the repository. Always verify release assets before distributing them.

_Initial repository setup via ChatGPT; Windows build and auto-update not yet verified._