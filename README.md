# MovieFlix workspace

This GitHub repository stores the project in **three branches**:

| Branch | Contents | Local folder |
|---|---|---|
| `main` | Backend API + release artifacts (`server/`) | `server/` (its own git repo) |
| `web` | React frontend source (`web/src`, styles, Capacitor config; Android project excluded until signing credentials are rotated) | `web/` (its own git repo) |
| `workspace` | Agent workflow: `AGENTS.md`, `Skills/`, `docs/`, `scripts/`, launcher scripts | project root (this repo; `server/`, `web/`, `backups/`, `promo/` ignored) |

Quick start for an agent: read `AGENTS.md`, then `Skills/README.md`.

Pushing:
```powershell
# backend (server repo)
git -C server push origin main
# frontend (web repo)
git -C web push origin HEAD:web
# this workflow repo
git push origin HEAD:workspace
```
