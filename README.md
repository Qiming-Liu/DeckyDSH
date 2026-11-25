# DeckyDSH

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that runs the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) agent on
SteamOS handhelds, from the Quick Access menu.

**Status: in development.** Nothing here is ready for players yet.

## How it works

- The plugin downloads the official single-file `dsh` runtime (it bundles its own
  Node.js) into its data folder on first use and checks its SHA-256 against
  `runtime/manifest.json`. No `sudo`, no Desktop Mode, and your own `~/.dsh` is left alone.
- It talks to `dsh --profile acp` over standard input and output.
- The `dsh/` submodule pins the DeepSeek Harness release the plugin is built and tested against.

DeepSeek Harness is experimental software. Read its
[safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)
before use: an agent can change or delete files and send data over the network.

## Development

```sh
git submodule update --init
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

Backend tests need no Decky runtime; run them with CPython 3.14, Decky's bundled interpreter.

`pnpm run runtime:manifest` refreshes `runtime/manifest.json` for the version pinned by
the submodule.
