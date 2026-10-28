# dsh-at-plugins

[中文](README.md) ｜ **English**

> An `@`-menu upgrade for DeepSeek Harness: plugins grouped into **System / User**, sessions grouped by folder, and section headers that stick, count, and fold.

Typing `@` in DSH normally offers files and sessions only. This plugin turns **the plugins you have installed** into a third kind of target, and chops long lists into readable chunks.

<p align="center">
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DSH-%E2%89%A50.2.1--rc.3-4C6EF5">
  <img alt="License" src="https://img.shields.io/badge/license-Source--Available-orange">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <a href="https://github.com/thynon/dsh-at-plugins/actions/workflows/check.yml"><img alt="check" src="https://github.com/thynon/dsh-at-plugins/actions/workflows/check.yml/badge.svg"></a>
</p>

## Screenshots

Both are real captures of the same `@` menu.

| Before | After |
|---|---|
| ![Before: the @ menu only offers files and sessions](docs/before.png) | ![After: two extra groups, System and User](docs/after.png) |
| Only "Files & folders" and "Sessions" | Two extra groups, System and User; the System group is folded in this shot |

The "after" capture happens to have the System group folded, which shows what a folded group looks like.

> Both captures are from 0.1.1. 0.1.2 makes headers sticky, adds a row-count badge, and draws the chevron and count with CSS pseudo-elements; 0.1.3 removes the heading-node injection; 0.1.4 keeps the menu open with a no-match row; 0.1.5 adds a query debounce and removes dynamic title attributes that could trigger native tooltips. The visual design is unchanged.

## Why

`@` is the fastest command surface in DSH, but it only knows files and workspace sessions. Once you install a few plugins, "which plugin gives me this feature?" means digging through Settings → Plugins.

So: feed the plugin inventory into `@`, and label where each entry came from — **System** (shipped with the client) and **User** (installed with `dsh plugin add`). Three extra rails for long lists: sticky counted section headers, foldable groups, and sessions grouped by folder.

## Features

### Plugins: System / User

| Signal | Bucket |
|---|---|
| `availability === 'installation'` (package lives in the DSH install) | System |
| `availability === 'profile'` (present only in the profile's `dependencies`, added with `dsh plugin add`) | User |

**`official` is not the System test**: an official optional package installed into your profile still has `official: true`, but it is not in the install directory — from your side it is something you added, so it belongs under User.

System first, User second; enabled entries first within a group, disabled ones carry a "disabled" note.
System plugins that shipped but are **not enabled** are omitted — `@`-ing them would do nothing.

Data comes from the host's `pluginManager.listBundles`. Read-only: no install, no uninstall, no toggling.

**No-match queries never return an empty list**: when no plugin matches, the source returns a "No matching plugins" row instead of `[]`. DSH closes the menu when every source is ready and empty; during IME composition (for example typing `chajian` before committing 插件) an intermediate query matches nothing, so returning empty closes the whole menu and the committed character reopens it — the menu appears to open and close. The placeholder is not pickable; press Esc to close.

While you keep typing, the plugin source waits about 120ms before applying the new query; the menu keeps the previous candidates during that window, so IME composition and fast typing do not shrink the menu to one row and expand it on every keystroke. It updates once you pause.

Plugin rows also get a small cleanup:

- `meta.icon` renders as a 14px image (only `data:image/...;base64` is accepted); otherwise a built-in box glyph is used
- version and description move into the right-hand meta text; descriptions are no longer hard-cut at 42 characters, CSS ellipsis handles the real width
- disabled rows end with "disabled" and sort last within their group

### Sessions grouped by folder

Sessions used to sit under a single "Sessions" heading. Now they group by each session's `cwd` folder:

```
default-workspace
  fix-login              1h
  sub-session            3min · subagent
Minecraft
  market-watch           now
```

- The folder of the current session comes first, then alphabetical
- Same-named folders (`~/work/src` and `~/play/src`) no longer merge: the current folder keeps the short name `src`, other collisions add parent segments and show as `play/src`
- Subagent sessions stay in their own folder, marked "subagent" in the description
- Sessions the client cannot resolve (other workspaces, deleted ones) fall back to the original "Sessions" group at the end — never dumped into an "Other folders" bucket

### Section headers: sticky, counted, foldable

- **Sticky**: the active group heading stops at the top of the menu while the list scrolls, so a long list never loses "which group am I in"
- **Count**: a small badge on the right shows how many rows the group has (hidden for single-row groups to cut noise); it still tells you how many were folded away
- **Fold**: groups with 3+ rows show a chevron and row count; click the heading itself. Both are CSS pseudo-elements, so nothing is injected into the React-managed heading node
- **Without stealing focus**: the heading prevents the default `mousedown`, so clicking it never blurs the composer; folding is a pointer enhancement and focus stays in the composer
- **`@` menu only**: identified through `[data-trigger-menu]` plus option-id prefixes, so the slash-command menu and model pickers are left alone

Headings use 14px / 650 with a sticky background and a divider, separating them from the 13px rows. Fold state persists for the window.

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

- **Plugin UI** follows the DSH language setting (Settings → General) and switches live: one `zh` and one `en` dictionary registered through `ctx.locale.register`. Section labels, fold hints and empty states all follow.
- **This README** ships in Chinese and English; GitHub cannot auto-switch, so the link at the top is manual.

## How it works

| Piece | Mechanism |
|---|---|
| Plugin candidates | `inputTriggers.registerSource({ trigger: '@', ... })`; `meta.icon` wrapped as a 14px image component |
| Session grouping | Wraps the `reference` source's `candidates()`; groups by `cwd` (not display name), rewrites `section` on `kind: 'session'` rows only, passes file rows through |
| Header enhancement | `MutationObserver` plus `[data-trigger-menu]` + option-id prefix detection; only sets `data-dshatp-count` / `foldable` / `folded`, with the chevron and count drawn by `::before` / `::after` |
| Sticky | `position:sticky` on headings plus `scroll-margin-top` so `scrollIntoView` does not park a row under the heading |
| Inline chip | Atomic `insert` + `codec` + a `conversation.user.text.node` renderer |

Traps worth knowing, documented in the code: never read a section name with `textContent` (pseudo-elements and extra nodes end up in it); writing an unchanged `data` attribute re-triggers the `MutationObserver` and self-oscillates; never inject children into a React-managed heading or move its text node — React removes them on re-render or `removeChild` fails, and the menu flickers while typing; a sticky heading covers the `scrollIntoView` target unless you reserve `scroll-margin-top`.

## Limits

- Only **running** packages are listed (`installed` or `enabled`); official optional packages that are not installed, shipped-but-disabled system plugins, and plain non-bundle profile dependencies are all omitted.
- Read-only by design; manage plugins in Settings → Plugins.
- A no-match query keeps the menu open with a "No matching plugins" row; press Esc or delete the `@` to close it.
- Plugin inventory is cached for 5 seconds.
- Folding is **visual**: hidden rows remain in the menu's data model. When an arrow key lands on a hidden row, the plugin walks in the same direction to the nearest visible row (through the menu's own hover path); Enter/Tab on a hidden row is still swallowed rather than picking something invisible.
- Folding is a heading-click (pointer) enhancement; focus stays in the composer, so keyboard users can arrow past a folded group but cannot open or close it from the keyboard. If upstream ever exposes a data-level menu filter, this can become a real data fold.
- Session grouping depends on upstream `ui-reference` row shape (`kind: 'session'` in `value`) and `sessions.list`'s `cwd`. If upstream changes, it degrades to the original layout instead of dropping candidates.
- Menu enhancement relies on `[data-trigger-menu]`, `[role="listbox"]`, `[role="presentation"]` and the `dsh-slash-option-<source>-` id prefix; a structural overhaul can disable it — the symptom is "no sticky heading / no fold chevron", never a broken `@`.
- Plugin icons only accept `data:image/...;base64` in `meta.icon`; an invalid or failing image falls back to the built-in glyph.
- Folder disambiguation tries up to three parent segments; extremely deep duplicate paths could still collide (they sort by final label and never drop rows).

## Development

```bash
node check.mjs
```

No browser, no DSH: a tiny React/DOM stand-in runs `client.js` and `index.js` for real — the host prompt, the plugin source and System/User split, folder bucketing with same-name disambiguation, plugin icons and long descriptions, empty/error/no-match placeholder states, query debounce, sticky headings and counts, the fold click round-trip, `@`-menu detection without touching the slash menu, `onPick`'s insert shape and `codec`, and chip rendering. CI runs the same file on every push.

## License

This is **not** an OSI-approved open-source license. It is source-available, noncommercial:

- ✅ Use, modify, create derivative works, redistribute — free of charge
- ✅ Derivative works must credit the original author **inside a source file**, not only in the README
- ❌ No charging without written permission, including for derivative works
- ❌ Derivative works may not be relicensed under a more permissive license (no switching back to MIT / Apache-2.0)

Full terms in [LICENSE](LICENSE). For commercial licensing, contact [@thynon](https://github.com/thynon).
