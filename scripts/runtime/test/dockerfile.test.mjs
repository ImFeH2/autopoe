import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfileUrl = new URL("../../../Dockerfile", import.meta.url);
const developmentDockerfileUrl = new URL(
  "../../../Dockerfile.dev",
  import.meta.url,
);
const dockerignoreUrl = new URL("../../../.dockerignore", import.meta.url);

function instructions(source) {
  const result = [];
  let current = "";
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    current = current ? `${current} ${line}` : line;
    if (current.endsWith("\\")) {
      current = current.slice(0, -1).trimEnd();
      continue;
    }
    result.push(current);
    current = "";
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function productionStage(source) {
  const parsed = instructions(source);
  const finalFrom = parsed.findLastIndex((instruction) =>
    instruction.startsWith("FROM "),
  );
  assert.notEqual(finalFrom, -1);
  return parsed.slice(finalFrom);
}

test("production Dockerfile keeps uv in the backend build stage", async () => {
  const source = await readFile(dockerfileUrl, "utf8");
  assert.match(
    source,
    /^FROM ghcr\.io\/astral-sh\/uv:python3\.13-bookworm-slim@sha256:531f855bda2c73cd6ef67d56b733b357cea384185b3022bd09f05e002cd144ca AS backend-builder$/m,
  );
  assert.match(
    source,
    /^RUN uv sync --project backend --frozen --no-dev --no-install-package flowent-native$/m,
  );
  assert.match(
    source,
    /^FROM python:3\.13-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS runtime$/m,
  );
  assert.match(
    source,
    /^FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS frontend-builder$/m,
  );

  const runtime = productionStage(source).join("\n");
  assert.doesNotMatch(runtime, /(^|\s)uv(\s|$)/i);
  assert.match(
    runtime,
    /COPY --from=backend-builder --chown=flowent:flowent \/app\/backend \/app\/backend/,
  );
});

test("production Dockerfile installs its command protection and search tools", async () => {
  const source = await readFile(dockerfileUrl, "utf8");
  const runtime = productionStage(source).join("\n");
  assert.match(runtime, /apt-get install .*\bbubblewrap\b/);
  assert.match(runtime, /apt-get install .*\bripgrep\b/);
  assert.match(runtime, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test("production Dockerfile preserves the application runtime contract", async () => {
  const source = await readFile(dockerfileUrl, "utf8");
  const runtime = productionStage(source);
  assert.ok(runtime.includes("ENV FLOWENT_STATIC_DIR=/app/frontend"));
  assert.ok(runtime.includes("ENV FLOWENT_SYSTEM_RUNTIME=1"));
  assert.ok(
    runtime.includes(
      "COPY --from=frontend-builder /app/frontend/dist /app/frontend",
    ),
  );
  assert.match(
    runtime.join("\n"),
    /mkdir -p \/home\/flowent\/\.flowent \/workspace/,
  );
  assert.ok(runtime.includes("USER flowent"));
  assert.ok(runtime.includes("WORKDIR /workspace"));
  assert.ok(runtime.includes("EXPOSE 6873"));
  assert.ok(runtime.includes('CMD ["/app/backend/.venv/bin/flowent"]'));
});

test("development Dockerfile skips the packaged native companion", async () => {
  const source = await readFile(developmentDockerfileUrl, "utf8");
  const parsed = instructions(source);

  assert.match(
    source,
    /^FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d$/m,
  );
  assert.match(
    source,
    /^COPY --from=ghcr\.io\/astral-sh\/uv:0\.8\.14@sha256:f3660c56d5b08d6c516360981bedc439f499b9bf37f46a216018da3777a74011 \/uv \/uvx \/usr\/local\/bin\/$/m,
  );

  assert.ok(
    parsed.includes(
      "RUN uv sync --project backend --frozen --no-install-package flowent-native",
    ),
  );
  assert.ok(
    !parsed.includes("COPY native/flowent-native ./native/flowent-native"),
  );
});

test("Docker context excludes generated native and package artifacts", async () => {
  const patterns = (await readFile(dockerignoreUrl, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  assert.ok(patterns.includes(".artifacts"));
  assert.ok(patterns.includes("backend/dist"));
  assert.ok(patterns.includes("native/**/target"));
});
