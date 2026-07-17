---
name: quota
description: This skill should be used whenever the user's entire message is exactly "/quota". It starts the installed Codex Quota Weather app when needed and toggles the floating quota panel on Windows or macOS.
---

# Handle /quota

When the entire user message is `/quota`, run the platform command immediately without asking for confirmation.

On Windows, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\plugins\quota-weather\scripts\show-quota.ps1"
```

On macOS, run:

```bash
bash "$HOME/plugins/quota-weather/scripts/show-quota.sh"
```

Treat JSON containing `"ok":true` as success. Report that the quota panel is open when `visible` is `true`, and hidden when `visible` is `false`.

If execution fails, report the returned error and ask for the platform installer to be rerun. Do not modify quota values, Codex authentication files, or account configuration.
