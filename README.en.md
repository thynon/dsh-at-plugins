# dsh-at-plugins

[中文](README.md) ｜ **English**

> An `@`-menu upgrade for DeepSeek Harness: plugins grouped into **System / User**, sessions grouped by folder, and foldable section headers.

Typing `@` in DSH normally offers files and sessions only. This plugin turns **the plugins you have installed** into a third kind of target, and chops long lists into readable chunks.

<p align="center">
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DSH-%E2%89%A50.2.1--rc.3-4C6EF5">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
</p>

<!-- Screenshots placeholder: uncomment once before.png / after.png land

## Screenshots

| Before | After |
|---|---|
| ![before](docs/before.png) | ![after](docs/after.png) |

-->

## Why

`@` is the fastest command surface in DSH, but it only knows files and workspace sessions. Once you install a few plugins, "which plugin gives me this feature?" means digging through Settings → Plugins.

So: feed the plugin inventory into `@`, and label where each entry came from — **System** (shipped with the client) and **User** (installed with `dsh plugin add`). Two extra rails for long lists: foldable section headers, and sessions grouped by folder.

## Features

### Plugins: System / User

| Signal | Bucket |
|---|---|
| `availability === 'installation'` (package lives in the DSH install's `package.json`) | System |
| `official === true` (official bundled / optional package) | System |
| Everything else, present only in the profile's `dependencies` | User |

System first, User second; enabled entries first within a group, disabled ones carry a "disabled" note.
System plugins that shipped but are **not enabled** are omitted — `@`-ing them would do nothing.

Data comes from the host's `pluginManager.listBundles`. Read-only: no install, no uninstall, no toggling.

### Sessions grouped by folder

Sessions used to sit under a single "Sessions" heading. Now they group by the `cwd` basename:

```
default-workspace
  fix-login              1h
  sub-session            3min · subagent
Minecraft
  market-watch           now
```

- The folder of the current session comes first, then alphabetical
- Subagent sessions stay in their own folder, marked "subagent" in the description
- Sessions the client cannot resolve (other workspaces, deleted ones) fall back to the original "Sessions" group at the end — never dumped into an "Other folders" bucket

### Foldable section headers

Each heading has a `▾` / `▸` on the right; click the chevron or the heading itself to fold the group (buttons appear at 3+ rows). Fold state persists for the window.
Headings are also a size up (14px / 700, with a divider) to separate them from the 13px rows.

### The plugin reference is an atomic chip

Picking a plugin inserts an **atomic reference**, the same node type as file and session references — not plain characters:

- the composer shows a `@ Plugin Market` pill; one backspace removes the whole thing
- `codec.serialize` restores the model form on submit
- the transcript renders the same chip through `conversation.user.text.node`

What the model sees:

```
@[Plugin Market](dsh-plugin:dshmarket) refresh the source list for me
```

The host half also appends a system-prompt section explaining the notation: the user named a plugin, prefer its capabilities.

## Install

Requires DeepSeek Harness ≥ 0.2.1-rc.3 and Node ≥ 22.

```bash
git clone git@github.com:thynon/dsh-at-plugins.git
cd dsh-at-plugins

# 1. Attach the package to your profile: dependencies + dsh.profile.bundles
node install.mjs ~/.dsh/profiles/desktop .

# 2. Link it into node_modules
cd ~/.dsh/profiles/desktop && pnpm install
```

Then **restart DeepSeek Harness** — a new bundle needs the profile recomposed. After that, editing `client.js` only needs a page refresh.

Prefer doing it by hand? Two edits in `~/.dsh/profiles/desktop/package.json`:

```jsonc
{
  "dsh": { "profile": { "bundles": [ /* … */, "dsh-at-plugins" ] } },
  "dependencies": {
    "dsh-at-plugins": "link:/absolute/path/to/dsh-at-plugins"
  }
}
```

## Uninstall

Drop `dsh-at-plugins` from `dsh.profile.bundles` (the dependency line may stay), restart. Nothing else is touched — its only host-side footprint is one prompt section, reclaimed on unload.

## Language

- **Plugin UI** follows the DSH language setting (Settings → General) and switches live: one `zh` and one `en` dictionary registered through `ctx.locale.register`. Section labels, button copy and empty states all follow.
- **This README** ships in Chinese and English; GitHub cannot auto-switch, so the link at the top is manual.

## How it works

| Piece | Mechanism |
|---|---|
| Plugin candidates | `inputTriggers.registerSource({ trigger: '@', ... })` |
| Session grouping | Wraps the `reference` source's `candidates()`; rewrites `section` on `kind: 'session'` rows only, passes file rows through untouched |
| Fold buttons | `MutationObserver` plus DOM enhancement on `[role="listbox"] > [role="presentation"]` |
| Inline chip | Atomic `insert` + `codec` + a `conversation.user.text.node` renderer |

Three traps worth knowing, documented in the code: never read a section name with `textContent` (the fold button's own `▾` becomes part of the name and the fold state can never match); writing an unchanged `data` attribute re-triggers the `MutationObserver` and self-oscillates; the fold button must be restored synchronously, or it flickers on every keystroke.

## Limits

- Only **running** packages are listed (`installed` or `enabled`).
- Read-only by design; manage plugins in Settings → Plugins.
- Plugin inventory is cached for 5 seconds.
- Folding is **visual**: hidden rows remain in the menu's data model, so arrow keys still traverse them. Enter/Tab on a hidden row is swallowed rather than picking something invisible.
- Session grouping depends on upstream `ui-reference` row shape (`kind: 'session'` in `value`) and `sessions.list`'s `cwd`. If upstream changes, it degrades to the original layout instead of dropping candidates.
- Menu enhancement targets semantic hooks (`[role="listbox"]`, `[role="presentation"]`) rather than hashed class names, but a structural overhaul could still disable it — the symptom is "buttons gone", never a broken `@`.

## Development

```bash
node check.mjs
```

No browser, no DSH: a tiny React/DOM stand-in runs `client.js` for real — grouping and ordering, folder bucketing, the fold click round-trip, `onPick`'s insert shape and `codec`, and chip rendering. CI runs the same file on every push.

## License

MIT © [thynon](https://github.com/thynon)
