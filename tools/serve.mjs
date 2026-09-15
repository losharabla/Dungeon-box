/**
 * Zero-dependency static file server.
 *
 * SRP: serve this directory over HTTP so the game's ES modules can be
 * loaded. ES modules cannot be imported from a `file://` URL because of
 * CORS, so the game needs *a* server — this one exists to avoid requiring
 * any npm install.
 *
 * Usage:  node tools/serve.mjs [port] [--open] [--host <addr>] [--help]
 *
 * Port selection is deliberately forgiving. Windows lets Hyper-V, WSL and
 * Docker reserve large blocks of the dynamic port range, and those blocks are
 * re-rolled on reboot or when `winnat` restarts — which is why binding 8080
 * can work in the morning and fail with `EACCES` (errno -4092) after lunch.
 * Nothing is listening in that case; the port is simply forbidden. So a
 * failure to bind is not an error the user should have to debug: the next
 * candidate is tried automatically, and the address actually used is the one
 * printed (and the one the browser is opened at).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ports tried after the requested one, best first. They sit below the ranges
 * Windows/Hyper-V commonly reserve, and the list ends with `0`, which asks the
 * OS for any free port — a fallback that cannot itself be reserved.
 * @type {number[]}
 */
const FALLBACK_PORTS = [3000, 5173, 8888, 9080, 5000];

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  // Music. Without a real audio type the browser is free to refuse the stream
  // rather than sniff it, and `<audio>` would silently never start.
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
};

const USAGE = `
The game's static server.

  node tools/serve.mjs [port] [--open] [--host <address>]

  port           first port to try (defaults to $PORT or 8080)
  --open         open the game in a browser once it is up
  --host <address> address to bind (default 127.0.0.1 - this machine only)
                 --host 0.0.0.0 also serves other devices on the network
  --help         this help

If a port is reserved by Windows or already in use, the next candidate is
tried automatically (${FALLBACK_PORTS.join(', ')}, then any free port).
`.trim();

/**
 * @param {string[]} argv
 * @returns {{port: number|null, host: string, open: boolean, help: boolean}}
 */
function parseArgs(argv) {
  /** @type {{port: number|null, host: string, open: boolean, help: boolean}} */
  const opts = { port: null, host: '127.0.0.1', open: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--open') opts.open = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--host') opts.host = argv[++i] ?? opts.host;
    else if (arg.startsWith('--host=')) opts.host = arg.slice('--host='.length);
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length));
    else if (/^\d+$/.test(arg)) opts.port = Number(arg);
  }

  return opts;
}

/**
 * Parse a single-range `Range:` request header.
 *
 * Only the one form a media element actually sends is supported
 * (`bytes=start-`, `bytes=start-end`, `bytes=-suffix`); anything else returns
 * null, and the caller answers with the whole file, which is always legal.
 *
 * @param {string|undefined} header
 * @param {number} size
 * @returns {{start: number, end: number}|null}
 */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // `bytes=-N`: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, size - 1);
  }

  if (start > end || start >= size) return null;
  return { start, end };
}

/** The request handler: static files from ROOT, and nothing outside it. */
function createServer() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = path.join(ROOT, url);

    // Directory requests resolve to index.html.
    if (url.endsWith('/')) filePath = path.join(filePath, 'index.html');

    // Refuse to serve anything outside the project directory.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.stat(resolved, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${url}`);
        return;
      }

      const type = CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream';
      const range = req.method === 'HEAD' ? null : parseRange(req.headers.range, stat.size);

      // Music is streamed, not buffered: a 3 MB track read into memory on
      // every request would be pointless work for a file the browser may only
      // ever read the first second of.
      if (range) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': range.end - range.start + 1,
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          // Media elements probe with Range to learn whether the file is
          // seekable; advertising it is what makes looping reliable.
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(resolved, { start: range.start, end: range.end })
          .on('error', () => res.destroy())
          .pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        // The game is edited live during development; never cache.
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(resolved)
        .on('error', () => res.destroy())
        .pipe(res);
    });
  });
}

/**
 * One bind attempt. Resolves with the listening server, or rejects with the
 * socket error (`EACCES` / `EADDRINUSE` / anything else).
 *
 * @param {number} port
 * @param {string} host
 * @returns {Promise<import('node:http').Server>}
 */
function tryListen(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    const onError = (/** @type {NodeJS.ErrnoException} */ err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Best-effort: open the game in the default browser. A missing opener must
 * never take the server down, so every failure is swallowed.
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : (platform === 'darwin' ? 'open' : 'xdg-open');
  // `start` treats the first quoted argument as the window title, hence "".
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available (headless/CI): the URL is already printed.
  }
}

/* ============================================================
   Driver
   ============================================================ */

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

const firstPort = opts.port ?? Number(process.env.PORT ?? 8080);
/** Requested port first, then the safe candidates, then "any free port". */
const candidates = [
  firstPort,
  ...FALLBACK_PORTS.filter((p) => p !== firstPort),
  0,
];

/** @type {import('node:http').Server|null} */
let server = null;
/** @type {NodeJS.ErrnoException|null} */
let lastError = null;

for (const candidate of candidates) {
  try {
    server = await tryListen(candidate, opts.host);
    break;
  } catch (err) {
    lastError = /** @type {NodeJS.ErrnoException} */ (err);
    const reserved = lastError.code === 'EACCES';
    const busy = lastError.code === 'EADDRINUSE';

    if ((reserved || busy) && candidate !== 0) {
      const why = reserved ? 'is reserved by Windows' : 'is already in use';
      console.log(`  port ${candidate} ${why} (${lastError.code}) - trying the next one`);
      continue;
    }

    console.error(`  could not start on port ${candidate}: ${lastError.message}`);
    break;
  }
}

if (!server) {
  console.error('');
  console.error('Could not start the server on any port.');
  console.error(`  last error: ${lastError?.code ?? 'unknown'} ${lastError?.message ?? ''}`);
  process.exit(1);
}

// After a successful bind, a later socket error is reported rather than
// thrown: one bad request must not kill the game.
server.on('error', (err) => console.error(`  [server] ${err.message}`));

const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
const url = `http://localhost:${port}/`;

console.log('');
console.log('The game server is running.');
console.log(`  ${url}`);
if (opts.host === '0.0.0.0') {
  console.log('  also reachable from other devices on this network');
}
console.log('');
console.log('Ctrl+C to stop it, or just close this window.');

if (opts.open) openBrowser(url);

process.on('SIGINT', () => {
  console.log('');
  console.log('Server stopped.');
  server?.close();
  process.exit(0);
});
