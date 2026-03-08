# Security Best Practices Report

## Executive summary

This Electron app is a remote-content desktop wrapper, so its main risk is letting untrusted web content cross into the Electron shell or the host operating system. The highest-impact issues were tightened in this pass by restricting in-app navigation to trusted Zenius HTTPS origins, limiting `shell.openExternal()` to a short safe protocol allowlist, and installing a deny-by-default permission policy. The main remaining security risk is architectural: if a trusted Zenius-controlled origin is compromised, attacker JavaScript can still execute inside the app renderer, although the current sandboxing and permission restrictions reduce blast radius.

## High severity

### SBP-001: Untrusted web destinations could be rendered inside the Electron shell

Impact: Rendering arbitrary destinations inside Electron increases phishing, origin-confusion, and renderer-exploit exposure for any link or redirect the site can trigger.

Status: Resolved in this pass.

Evidence and mitigation:
- Trusted in-app origin classification now lives in `src/main.js:10`, `src/main.js:44`, and `src/main.js:54`.
- Top-level navigation and redirect interception now enforce that policy in `src/main.js:269`, `src/main.js:294`, and `src/main.js:298`.
- Popup windows now stay in-app only for trusted Zenius URLs or `about:blank` bootstrap windows in `src/main.js:279`.

Notes:
- The allowlist is intentionally HTTPS-only.
- Links to non-trusted web origins now leave the Electron shell and open in the external browser.

### SBP-002: Arbitrary URI schemes could be handed to the operating system

Impact: Passing unvetted schemes such as `file:`, custom app handlers, or other OS-resolved protocols to `shell.openExternal()` can trigger unsafe local behavior outside the browser sandbox.

Status: Resolved in this pass.

Evidence and mitigation:
- External URL parsing and protocol allowlisting now live in `src/main.js:19`, `src/main.js:58`, and `src/main.js:204`.
- Only `https:`, `mailto:`, and `tel:` are now eligible for `shell.openExternal()` via `src/main.js:12` and `src/main.js:204`.
- Unsupported protocols are blocked and logged instead of being dispatched to the OS in `src/main.js:205`.

## Medium severity

### SBP-003: The remote site had no explicit permission policy in Electron

Status: Resolved in this pass.

Evidence and mitigation:
- The app now installs session-level permission gates in `src/main.js:214`.
- Permission requests are deny-by-default, with only trusted-origin `fullscreen` allowed in `src/main.js:66`, `src/main.js:221`, and `src/main.js:229`.
- Device permissions are explicitly denied in `src/main.js:236`.

### SBP-004: The trusted-origin policy is still suffix-based

Status: Open residual risk.

Evidence:
- The in-app host allowlist currently trusts all hosts beneath `zenius.net` and `zenius.com` through `src/main.js:10` and `src/main.js:27`.

Risk:
- If a low-trust or forgotten subdomain under those zones is compromised, it can still be rendered in-app because it matches the current suffix rule.

Recommendation:
- Replace the suffix allowlist with exact production hosts once the real runtime flows are known.
- Review auth, payment, help-center, and video flows before tightening so legitimate redirects are not broken.

## Low severity

### SBP-005: BrowserWindow and preload hardening were not fully explicit

Status: Resolved in this pass.

Evidence and mitigation:
- The BrowserWindow security defaults are now explicit in `src/main.js:241`, including `safeDialogs`, `nodeIntegrationInSubFrames: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, and `webviewTag: false`.
- The preload bridge is now immutable via `src/preload.js:5` and `src/preload.js:9`.

### SBP-006: Security ownership analysis could not be generated

Status: Informational.

Evidence:
- The project directory is not a Git working tree, so the ownership-map workflow has no commit history to analyze.

Recommendation:
- Run the ownership-map workflow against a clone with `.git` history if you want bus-factor or sensitive-code maintainer analysis.

## Verification

- `npm test` passed.
- `npm run coverage` passed with 100% statements, branches, functions, and lines.
- `xvfb-run -a timeout 20s npm start -- --no-sandbox` started successfully and remained alive until the timeout terminated the GUI process.
- `npm run build:binary` succeeded and produced the versioned AppImage in `dist/`.
- `xvfb-run -a timeout 20s ./dist/<versioned-appimage> --no-sandbox` started the packaged build successfully and ended only because of the timeout.

## Residual risk summary

- The app still renders live remote content from `https://www.zenius.net/` via `src/main.js:9` and `src/main.js:339`.
- If a trusted allowed origin is compromised, attacker JavaScript can still run in the sandboxed renderer.
- The current controls reduce privilege and operating-system escape opportunities, but they do not remove dependency on the upstream site’s integrity.
