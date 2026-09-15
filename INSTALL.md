# Installing and running the game

This is the long version of the "Play it" section in the [README](README.md), with the
requirements spelled out and the troubleshooting at the end. If you just want to play, read
Option 1 or Option 2 and stop.

There is no installation step in the usual sense: the game has **no dependencies, no build
step and no package manager**. It is a folder of static files. The only thing it ever needs is
something to serve those files over HTTP.

---

## What you need

| | |
| --- | --- |
| **A browser** | Chrome, Edge, Firefox or Safari from the last few years. Desktop only — the game is keyboard and mouse. |
| **Node.js 18 or newer** | *Only* for running it locally. **Not needed for Option 1.** Get it from [nodejs.org](https://nodejs.org/) — the LTS installer is fine, there is nothing to configure. |
| **Nothing else** | No `npm install`, no bundler, no compiler. `package.json` exists for its scripts and declares zero dependencies. |

---

## Option 1 — Play it in the browser (nothing to install)

**<https://losharabla.github.io/Dungeon-box/>**

The repository is a static site, so the same files you would download are published through
GitHub Pages. This is the fastest way to see the game and the one to send to someone else.

Notes:

- The first sound is silent until you click something. That is the browser's autoplay policy,
  not a bug: the audio context is created on your first gesture.
- The music is a 2.7 MB MP3 that streams as you play, so it may take a moment to start on a
  slow connection.

---

## Option 2 — Download it and run it locally (Windows)

1. Open the [latest release](../../releases/latest) and download **Source code (zip)**.
2. Unpack the zip anywhere — your Desktop is fine. There is no installer and nothing is
   written outside that folder.
3. Double-click **`RUN.bat`**.

A console window opens, the local server starts, and the game opens in your default browser.
**Closing that console window stops the server.** While the server is running you can reopen
the game by going back to the address it printed.

If Node.js is not installed, the launcher tells you so and points you at
[nodejs.org](https://nodejs.org/) instead of closing before you can read why.

> **Why does a browser game need a server at all?** The game is built from ES modules, and
> browsers refuse to `import` one from a `file://` URL. Opening `index.html` by
> double-clicking it gives you a blank page and a console full of CORS errors. It has to be
> served over HTTP — any server will do, which is what `RUN.bat` sets up for you.

---

## Option 3 — Clone it and run it (any OS, and the way to develop)

```bash
git clone https://github.com/losharabla/Dungeon-box.git
cd Dungeon-box
node tools/serve.mjs --open
```

`tools/serve.mjs` is the same zero-dependency server the launcher uses:

```bash
node tools/serve.mjs                  # local only, first free port
node tools/serve.mjs 3000             # a specific port
node tools/serve.mjs --open           # open the browser as well
node tools/serve.mjs --host 0.0.0.0   # also serve other devices on your network
node tools/serve.mjs --help           # usage
```

It binds `127.0.0.1` by default and **prints the address it actually uses**, which is the one
to open. If the port you asked for is reserved by Windows (`EACCES`) or already taken
(`EADDRINUSE`), it silently moves to the next candidate (`3000`, `5173`, `8888`, `9080`,
`5000`, then any free port the OS hands out) and opens the browser at the right address.

That fallback is not paranoia. Hyper-V, WSL and Docker reserve large blocks of the Windows
dynamic port range and re-roll them on reboot or when `winnat` restarts, so binding `8080` can
work in the morning and fail in the afternoon with nothing listening on it.

### On macOS and Linux

The launcher is a Windows batch file, so use Option 3 instead — or any other static server:

```bash
python3 -m http.server 8080     # then open http://localhost:8080/
php -S localhost:8080
npx serve
```

Whatever you use, it must serve the repository root (the folder with `index.html` in it) and
it must send correct MIME types for `.js` and `.mp3`. Python's `http.server` and PHP's built-in
server both do.

---

## Playing with other people on your local network

```bash
node tools/serve.mjs --host 0.0.0.0
```

The server then listens on every interface and prints the address to use, for example
`http://192.168.1.42:8080/`. Anyone on the same network can open that address and play.

Two caveats: the game is single-player, so a second player gets their own separate run rather
than joining yours; and Windows Firewall will ask for permission the first time, which you have
to allow for the other device to connect.

---

## Troubleshooting

| What you see | What it is | What to do |
| --- | --- | --- |
| A blank black page, console full of `CORS policy` / `Failed to load module script` | You opened `index.html` from the file system | Serve it over HTTP — Option 1, 2 or 3 |
| `Node.js is not installed`, and the window closes when you press a key | No Node on the machine | Install it from [nodejs.org](https://nodejs.org/), then run `RUN.bat` again |
| The console says the port is reserved or in use, and then prints a *different* address | Windows reserved that port, or something else has it | Nothing — the server already moved on. Open the address it printed. |
| The page loads but there is no sound at all | The browser has not been given a user gesture yet, or the tab is muted | Click once inside the game. The `Sound` button in the main menu opens the mixer. |
| The music never starts; the console mentions a media error | The MP3 failed to load or decode | The game counts the failure and stays silent rather than crashing. Check that `assets/music/shadow-labyrinth.mp3` exists at the repository root. |
| The music stutters or does not loop | A static server that does not answer HTTP Range requests | Use the bundled `tools/serve.mjs`, which implements `206 Partial Content` |
| Everything is drawn but nothing responds to the keyboard | The canvas does not have focus | Click once on the game area |
| `EACCES` / `errno -4092` when you bind a port yourself | A Windows-reserved port range, not a permission problem on your files | Pick another port, or let `tools/serve.mjs` choose |

---

## What the game stores on your machine

Only your mixer settings, in `localStorage` under the key `rogalik.audio.v3` — master, music
and effects levels plus the mute flag. Nothing else is written, and clearing site data resets
it. The game makes no network requests after loading: there is no telemetry, no account and no
analytics.

---

## For developers

The same clone runs the test suite. Node is the only requirement.

```bash
npm test              # 136 headless checks: engine, DOM, graphics, balance, audio, frame budgets
npm run test:all      # the above plus the long simulations (soak, arenas, campaigns)
npm run perf          # where a frame's time goes, per weapon
npm run shots         # re-shoot docs/screenshots/ in a real headless browser
npm run preview       # render one frame with the offline software rasteriser
```

See the [README](README.md#tests) for what each suite covers, and
[`DESIGN.md`](DESIGN.md) for the design document the implementation follows.
