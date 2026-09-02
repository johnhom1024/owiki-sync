# owiki-sync

English · [中文](README.md)

An Obsidian plugin that syncs your vault across devices through a self-hosted [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo) server.

Your notes never touch a third-party cloud — they only ever travel through your own server.

> [!WARNING]
> **Experimental software**: both this plugin and the OWiki server are in an early experimental stage. The sync logic has not been validated at scale, and edge cases **may cause note data loss or corruption**. **Back up your vault before connecting** (keep a full copy independent of the sync pipeline). **We are not responsible for any data loss caused by using this plugin** (see the [MIT LICENSE](LICENSE)).

## Features

- **Incremental sync** — hash-list reconciliation; only changed files transfer. When both sides match, zero bytes move
- **Real-time push** — saves upload automatically (2s debounce); other devices receive changes within seconds
- **Conflict handling** — baseHash optimistic locking with line-level three-way merge; when a merge is impossible, the remote version is saved as `xxx.conflict.md` so nothing is ever lost
- **Resilient connection** — automatic reconnect with exponential backoff; changes made while offline are queued and delivered on reconnect
- **Structure sync** — rename / delete are first-class operations; the server moves paths in place and broadcasts to all devices
- **Per-device authorization** — every device gets its own identity; new devices join via PIN and can be unbound at any time
- Works on desktop and mobile

## Requirements

This plugin ships without a server. Deploy [OWiki](https://cnb.cool/johnhom1024/owiki-monorepo) first (Go + WebSocket + SQLite — one container or a single binary):

```bash
docker run -d --name owiki \
  -p 8787:8787 \
  -e OWIKI_TOKEN=<sync-token> \
  -e OWIKI_ADMIN_USER=admin \
  -e OWIKI_ADMIN_PASSWORD=<strong-password> \
  -v ./owiki-data:/data \
  docker.cnb.cool/johnhom1024/owiki:latest
```

Open `http://<server>:8787` in a browser, sign in, and create a vault in the web console to get a sync token.

## Installation

**From the community directory** (once listed): Obsidian → Settings → Community plugins → Browse → search for `owiki-sync`

**Manual**: download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/johnhom1024/owiki-sync/releases) and drop them into:

```
<your-vault>/.obsidian/plugins/owiki-sync/
```

**Before it's listed (BRAT)**: install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, add `johnhom1024/owiki-sync` as a beta plugin in its settings, and you'll get the plugin — plus automatic updates with every GitHub release — before the official listing goes live.

## Usage

1. Enable the plugin and open its settings; enter your server address and sync token
2. The first connection reconciles automatically: remote-only files come down, local-only files go up
3. From then on it runs in the background — edits, renames, and deletes all sync automatically

The status bar shows connection state and sync progress in real time; the settings page lists authorized devices and the sync log.

## How it works

```
start  → send {path, hash, mtime} manifest → server compares → transfer diffs only
edit   → 2s debounce → upload → server broadcasts → other devices pull on demand
```

Every file is fingerprinted with SHA-256 for reconciliation; writes carry an optimistic-lock version; a 30s heartbeat keeps the connection alive.

## Development

```bash
pnpm install
pnpm build       # production build (minified)
pnpm typecheck   # type checking
```

For deploying to a local vault, see [TESTING.md](TESTING.md) (in Chinese).

## License

[MIT](LICENSE)
