# phstash

**18+ only.** A [Stash](https://github.com/stashapp/stash) plugin for [playhound](https://github.com/whatmekota/playhound). It puts your Stash collection in playhound's library: the scenes with a script show next to your own videos with a **Stash** badge, and play streamed from Stash with their funscript, tags, performers, markers and screenshot. Nothing is copied or downloaded.

<!-- Screenshot: add docs/library.webp (Stash scenes in the library) and link it here. -->

Needs playhound **2.2** or newer, in the desktop app or a browser, and Stash **0.25** or newer.

## Install

In playhound: **Settings → Plugins**. Under **Discover**, **Add from GitHub** `whatmekota/phstash` and click **Install**, or download `phstash-<version>.zip` from [Releases](https://github.com/whatmekota/phstash/releases) and drop it on that page. It asks for three permissions:

- **Connect to servers through playhound**: to talk to your Stash.
- **Add videos to your library from another app**: the scenes themselves.
- **See what is playing**: only for **Tell Stash** below (which scene plays, and when you mark "I came"), which is off until you switch it on.

## Using it

Switch it on, and if Stash isn't at `http://localhost:9999`, type its address in its settings. Its scenes with a funscript appear in the **Library** under a **Stash** badge, and **Stash** in the folder picker shows only them. They search, sort, star, queue and go in playlists like your own videos.

- Each scene brings its **title** (or its file name), its **funscript**, its **tags**, its **performers and studio** as tags too, its **markers** as the script's chapters, its **screenshot** and its **length**. Its info links back to the scene in Stash.
- Playing one streams it from Stash. A file a browser can't play (WMV, AVI…) is converted by Stash as it plays (HLS, a few seconds at a time), so it seeks like any other; it takes a moment to start, and Stash's CPU.
- The **Stash** panel (its button on the right-hand rail) says whether it's connected, how many scenes it has, when it last looked and when it looks next. **Look again** fetches the list now, **Test connection** says plainly what's wrong if something is, and **Open Stash** opens Stash itself. **Look for new scenes in Stash** is in the command palette (Ctrl K) too.

### A Stash with a password

Copy its API key from Stash (**Settings → Security → API Key**) into phstash's **API key**. It goes to Stash in a header, never in an address. With a key, the screenshots are fetched by phstash, made small and kept, since a picture in the library can't send a header; they fill in over the first minute or so.

Playing a scene from a Stash with a password goes through playhound's local stream proxy: the desktop app runs it; in a browser, run playhound's `start.bat` (or `pnpm dev:proxy`) too.

### Settings

In **Settings → Plugins → Stash**:

- **Address** and **API key**.
- **Scenes**: all of them, those **with a tag** (and its sub-tags, if you like), or a **saved filter** from Stash. **Only scenes with a script** (on by default) narrows any of them to the ones Stash marks interactive.
- **Look again**: every 5, 15, 30 (the default) or 60 minutes, or only when you ask.
- **Stream**: the file, converted by Stash when a browser won't play it (the default); always the file; or always converted.
- **Performers and studio as tags**.
- **Tell Stash**: **Count plays** adds a play to the scene in Stash once it has played for 10 seconds; **Count O's** adds to its O counter when you mark **I came** (C) during it. Both off unless you switch them on.

### When Stash is offline

The scenes it last saw stay in the library, under **Stash (offline)**, instead of disappearing, so your playlists, stars and queue keep them; they play again once Stash is back. phstash looks again every 2 minutes until it is. They're kept between restarts too, for the same address. Pointing phstash at another Stash takes the old one's scenes away.

## What it can't do

- **Multi-axis scripts**: Stash pairs one `.funscript` with each scene, the stroke, and serves only that one. Extra axes next to the video (`.twist.funscript`…) don't reach playhound through Stash.
- Stash's **rating** and **O counter** aren't shown in playhound, and playhound's stars don't go back to Stash.
- A saved filter is translated the way Stash's own UI does it. An unusual criterion Stash can't take this way shows its error in the panel.
- playhound takes up to 20,000 videos from one source.

## Privacy

phstash talks only to the Stash address you give it. It keeps its settings (the API key among them, in playhound's plugin storage on this computer), the last scene list and, with an API key, the small screenshots. With **Tell Stash** off it sends Stash nothing but questions.

## Build

    npm install
    npm run build          # dist/index.js and phstash.zip
    npm run build:public   # release/phstash-<version>.zip and release/manifest.json
    npm test
    npm run typecheck

`manifest.json` points at `dist/index.js`, so **Settings → Plugins → Load from folder…** runs this folder as it is after a build; the zip's copy points at `index.js`. `src/types.ts` is a copy of playhound's plugin contract (`src/plugins/types.ts`); keep it in step.

### Without a Stash

`npm run fake-stash` starts a pretend Stash on `http://127.0.0.1:9998` with a few made-up scenes: a test-pattern video (made once with ffmpeg, in `dev/media/`), funscripts, screenshots, tags, performers, markers, saved filters, a scene that needs converting (HLS) and one without a cover, answering the way a real Stash 0.32 does. `-- --api-key KEY` makes it want a key, `-- --version v0.24.0` makes it too old, `-- --scenes 1000` makes paging do some work. It logs every request, and shouts if a key ever arrives in an address.

## License

MIT
