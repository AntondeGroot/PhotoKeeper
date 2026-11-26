/* Renders the repo's link preview, docs/social-preview.png, from docs/social-preview.html.
 *
 *   npm run social-preview            regenerate the PNG
 *   npm run social-preview -- --check fail if the committed PNG is not what the template renders
 *
 * Exactly 1280×640 at one device pixel per CSS pixel, the size GitHub asks for. Upload it by hand:
 * Settings → General → Social preview. Needs Google Chrome, driven over the DevTools protocol, and
 * the network (the template loads its fonts from Google Fonts).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "docs/social-preview.html");
const OUTPUT = join(ROOT, "docs/social-preview.png");
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9341;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function openChrome(profile) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let tries = 0; tries < 100; tries++) {
    try {
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return chrome;
    } catch {
      await wait(100);
    }
  }
  chrome.kill();
  throw new Error(
    `Chrome never opened its debugging port (looked for it at ${CHROME})`,
  );
}

async function connect() {
  const targets = await (
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  ).json();
  const page = targets.find((t) => t.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((open, fail) => {
    socket.onopen = open;
    socket.onerror = fail;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.fail(new Error(message.error.message));
    else call.done(message.result);
  };
  return {
    send: (method, params = {}) =>
      new Promise((done, fail) => {
        const id = ++nextId;
        pending.set(id, { done, fail });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

async function render(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url: "file://" + TEMPLATE });
  /* The title is set in a web font; captured before it arrives, it comes out in the fallback. The
     template asks for display=block, and this waits for it. */
  await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(async () => {
      while (document.readyState !== 'complete') await new Promise(r => setTimeout(r, 50));
      await document.fonts.ready;
      if (!document.fonts.check('italic 600 104px Fraunces')) throw new Error('Fraunces did not load');
    })()`,
  });
  /* Loaded is not yet painted. Two captures in a row that agree mean it has settled. */
  let data = "";
  let previous;
  for (let tries = 0; tries < 20 && data !== previous; tries++) {
    previous = data;
    await wait(250);
    ({ data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 640, scale: 1 },
    }));
  }
  if (data !== previous)
    throw new Error(
      "The social preview never stopped changing between captures",
    );
  return Buffer.from(data, "base64");
}

const check = process.argv.includes("--check");
const profile = await mkdtemp(join(tmpdir(), "photokeeper-preview-"));
const chrome = await openChrome(profile);
let png;
try {
  const cdp = await connect();
  png = await render(cdp);
  cdp.close();
} finally {
  chrome.kill();
  await wait(300); // Chrome keeps writing to its profile for a moment after the signal.
  await rm(profile, { recursive: true, force: true });
}

if (check) {
  const committed = await readFile(OUTPUT).catch(() => null);
  if (!committed || !committed.equals(png)) {
    console.error(
      "docs/social-preview.png is stale: it is not what docs/social-preview.html renders.\n" +
        "Run `npm run social-preview` and commit the PNG (then re-upload it on GitHub).",
    );
    process.exit(1);
  }
  console.log("docs/social-preview.png is up to date");
} else {
  await writeFile(OUTPUT, png);
  console.log("wrote docs/social-preview.png");
}
