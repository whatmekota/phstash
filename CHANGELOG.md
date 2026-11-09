# Changelog

## 0.1.0

First version, for playhound 2.2 and newer, and Stash 0.25 and newer.

- Stash's scenes in playhound's **library**, under a **Stash** badge: streamed from Stash, with their funscript, tags, performers and studio, markers as chapters, screenshot, length and a link back to the scene. A file a browser can't play is converted by Stash as it plays (HLS), and seeks.
- **Which scenes**: all, with a tag (and its sub-tags), or a saved filter from Stash; by default only those with a script. Large collections are fetched a page at a time.
- A Stash with a password: its **API key** goes in a header, never in an address; screenshots are fetched with it and kept.
- **Offline**: the scenes last seen stay, under **Stash (offline)**, and come back to life when Stash does.
- The **Stash panel**: connection, scene count, last and next look, **Look again**, **Test connection**, **Open Stash**, and what went wrong in plain words.
- **Tell Stash** (off by default): count plays, and O's when you mark "I came".
- Looks again every 30 minutes (or 5, 15, 60, or only when asked).
