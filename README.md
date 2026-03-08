# Zenius Desktop

Desktop wrapper for `https://www.zenius.net/` built with Electron.

## Overview

Zenius Desktop packages the Zenius web experience as a native desktop application for:

- GNU/Linux
- macOS
- Windows

The app loads the live Zenius site inside Electron, uses the Zenius icon set, removes the default Electron menu bar, and keeps platform packaging in one repository.

## Download

Compiled binaries are published in GitHub Releases:

- Latest release: https://github.com/panggi/zenius-desktop/releases/latest
- All releases: https://github.com/panggi/zenius-desktop/releases

## Versioning

The application version has a single source of truth:

- `package.json`

Useful command:

```bash
npm run version:print
```

Build artifact names are generated from that same version through Electron Builder.

## Requirements

- Node.js 20+
- npm 10+

## Install

```bash
npm install
```

## Run locally

Standard local launch:

```bash
npm start
```

If your Linux environment requires Electron to run without the Chromium sandbox helper, use:

```bash
npm run start:no-sandbox
```

## Build

Build all configured installers for the current platform:

```bash
npm run dist
```

Build an unpacked directory for the current platform:

```bash
npm run pack
```

Build a GNU/Linux AppImage:

```bash
npm run build:binary
```

or:

```bash
npm run build:linux
```

Build a macOS DMG:

```bash
npm run build:mac
```

Build a Windows NSIS installer:

```bash
npm run build:win
```

Generated installer names follow this pattern:

```text
Zenius-<version>-<os>-<arch>.<ext>
```

Example for the current Linux build:

```text
dist/Zenius-<version>-linux-x86_64.AppImage
```

## Test

Run the test suite:

```bash
npm test
```

Run the coverage gate:

```bash
npm run coverage
```

Coverage is enforced at:

- 100% statements
- 100% branches
- 100% functions
- 100% lines

## Security behavior

The app applies a restrictive Electron security policy:

- Node integration is disabled for renderer content.
- Context isolation and renderer sandboxing are enabled.
- Webviews are blocked.
- Only trusted Zenius HTTPS origins stay inside the main app window.
- External links open in the system browser only for approved protocols.
- Electron permission requests are denied by default.

Google sign-in is supported with a narrow exception:

- `accounts.google.com` is allowed to stay inside the app for the OAuth flow.
- Other non-Zenius destinations still open in the system browser.

## GitHub Actions

The repository includes a GitHub Actions workflow at:

- `.github/workflows/build.yml`

It does the following:

- reads the version from `package.json`
- runs tests and the coverage gate on Ubuntu
- builds installers for GNU/Linux, macOS, and Windows
- uploads the generated installers as workflow artifacts
- publishes GNU/Linux, macOS, and Windows binaries to GitHub Releases on version tags

macOS signing and notarization:

- release macOS builds are signed and notarized in GitHub Actions
- signing/notarization is performed only in the GitHub Actions macOS job
- tag builds fail if the required Apple secrets are missing

Required GitHub Secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Release publishing rules:

- release assets are created only from GitHub Actions build outputs
- the Git tag must match the app version in `package.json`
- example: if `package.json` is `0.1.1`, the release tag must be `v0.1.1`

Typical release flow:

```bash
git tag v$(npm run --silent version:print)
git push origin main --tags
```

The workflow runs on:

- pull requests
- pushes to `main`
- tags matching `v*`
- manual dispatch

## Project structure

```text
.
├── .github/workflows/build.yml
├── assets/
├── src/
│   ├── main.js
│   └── preload.js
├── test/
├── package.json
└── README.md
```

## License

This project is licensed under the MIT License. See [LICENSE](/home/panggi/Codes/Electron/Zenius/LICENSE).
