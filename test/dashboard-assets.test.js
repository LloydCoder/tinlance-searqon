import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createAppServer } from "../apps/web/server.js";

const workspaceHtml = new URL("../apps/web/public/app/index.html", import.meta.url);
const dashboardScript = new URL("../apps/web/public/app/dashboard.js", import.meta.url);
const dashboardModel = new URL("../apps/web/public/app/dashboard-model.js", import.meta.url);
const dashboardStyles = new URL("../apps/web/public/app/dashboard.css", import.meta.url);
const workspaceStyles = new URL("../apps/web/public/app/workspace.css", import.meta.url);

test("authenticated workspace loads the additive command center assets", async () => {
  const html = await readFile(workspaceHtml, "utf8");
  assert.match(html, /id="command-center"/);
  assert.match(html, /src="\/app\/dashboard\.js"/);
  assert.match(html, /href="\/app\/dashboard\.css"/);
  assert.match(html, /id="command-center-actions"/);
  assert.match(html, /id="command-center-coverage"/);
  assert.match(html, /noindex, nofollow/);
});

test("dashboard browser assets pass Node syntax validation", async () => {
  for (const file of [dashboardScript, dashboardModel]) {
    const result = spawnSync(process.execPath, ["--check", file.pathname], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("workspace styling follows the supplied flat-color Searqon brand rules", async () => {
  const [dashboard, workspace] = await Promise.all([
    readFile(dashboardStyles, "utf8"),
    readFile(workspaceStyles, "utf8")
  ]);
  const css = dashboard + "\n" + workspace;
  assert.match(css, /#FFFEFA/);
  assert.match(css, /var\(--ink\)/);
  assert.match(css, /font:500 12px\/18px var\(--mono\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|box-shadow|drop-shadow|text-shadow/);
});

test("web server serves the command center JavaScript and stylesheet assets", async () => {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const base = "http://127.0.0.1:" + address.port;
  try {
    const script = await fetch(base + "/app/dashboard.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
    assert.match(await script.text(), /buildDashboardModel/);

    const model = await fetch(base + "/app/dashboard-model.js");
    assert.equal(model.status, 200);
    assert.match(model.headers.get("content-type"), /javascript/);

    const stylesheet = await fetch(base + "/app/dashboard.css");
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /text\/css/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
