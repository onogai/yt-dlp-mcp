# Switchboard add-on package

This repository's `switchboard-addon.yaml` packages the **existing forked stdio MCP** as a one-container schema-v2 add-on. The Docker image contains yt-dlp, ffmpeg, the compiled TypeScript MCP and a pinned Supergateway HTTP adapter.

Requires Switchboard Core with one-service schema-v2 support (PR #118 or later).

## Fresh installation (no existing source collision)

```bash
cd ~/agent-switchboard
./switchboard addon https://github.com/onogai/yt-dlp-mcp.git --name youtube --target production
./switchboard addons
./switchboard addon logs youtube
```

This creates `addons/youtube/state/downloads`, a new private Compose project `switchboard-addon-youtube`, and a **new** MCP source `youtube`. It does **not** replace the existing `ytdlp` source, existing eight grants, or the shared `switchboard-services-ytdlp` container. Do not remove or re-register the existing source during this test.

Before production cutover, compare discovered tool names/schema with the existing `ytdlp` source. The source code currently declares ten tools; only eight may be active in the existing Gateway. Preserving the old source ID and grants requires a dedicated guarded cutover and verification, not a fresh install.

For safety, `YTDLP_IGNORE_CONFIG=1`; the package does not import old host cookies, proxy settings, downloaded media, or credentials. Re-enable those only after reviewing and explicitly packaging the required private configuration.

## Verification

Use `docker compose` to check health and `tools/list` on the add-on's private MCP endpoint. Verify subtitle retrieval and metadata calls against a public video before any cutover. Do not claim production parity from a successful build alone: the yt-dlp runtime's JavaScript challenge support and version must be validated against YouTube during E2E acceptance.
