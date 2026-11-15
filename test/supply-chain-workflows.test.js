import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("supply-chain workflows pin actions and enforce least-privilege release permissions", async () => {
  const secrets = await readFile(new URL("../.github/workflows/secret-scan.yml", import.meta.url), "utf8");
  const release = await readFile(new URL("../.github/workflows/release-provenance.yml", import.meta.url), "utf8");
  const dependabot = await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
  assert.match(secrets, /gitleaks_8\.30\.1_linux_x64\.tar\.gz/);
  assert.match(secrets, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(secrets, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(secrets, /fetch-depth: 0/);
  assert.match(release, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(release, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(release, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
  assert.match(release, /attestations: write/);
  assert.match(release, /artifact-metadata: write/);
  assert.match(release, /npm sbom --sbom-format cyclonedx/);
  assert.match(release, /git merge-base --is-ancestor/);\n  assert.match(release, /fetch-depth: 0/);
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.match(dependabot, /package-ecosystem: "npm"/);\n  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");\n  assert.match(ci, /actionlint_1\\.7\\.12_linux_amd64/);\n  assert.match(ci, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
});
