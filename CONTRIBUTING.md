# Contributing

Contributions are welcome, especially fixes for quota parsing, Windows process
detection, accessibility, and coherent weather scenes.

## Setup

```powershell
npm ci
npm test
npm run test:electron
npm run test:app
npm start
```

Before submitting a pull request:

1. Keep the local service bound to `127.0.0.1`.
2. Never log or return the Codex access token.
3. Preserve reduced-motion behavior for new effects.
4. Run `npm test`, `npm run test:electron`, `npm run test:app`, and
   `npm audit --audit-level=high`.
5. Update screenshots with `npm run capture:docs` and
   `python scripts/build-doc-gifs.py` when the UI changes.

New photographs must include a source and license entry in
`THIRD_PARTY_NOTICES.md`.

Platform changes must keep both the Windows PowerShell installer and macOS shell
installer working. CI validates Windows x64, Apple Silicon macOS, and Intel macOS.
