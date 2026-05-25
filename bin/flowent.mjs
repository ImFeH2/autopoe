#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendProject = join(packageRoot, "backend");
const staticDirectory = join(packageRoot, "dist", "frontend");
const passthroughArgs = process.argv.slice(2);

function firstCommand(args) {
  const optionsWithValues = new Set([
    "--app-data-dir",
    "--host",
    "--hostname",
    "--port",
    "-p",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (
      arg === "--help" ||
      arg === "-h" ||
      arg === "--version" ||
      arg === "-v"
    ) {
      return arg;
    }

    if (arg.startsWith("-")) {
      if (optionsWithValues.has(arg) && args[index + 1]) {
        index += 1;
      }
      continue;
    }

    return arg;
  }

  return "";
}

function startsServer(args) {
  return firstCommand(args) === "";
}

if (!existsSync(join(backendProject, "pyproject.toml"))) {
  console.error(
    "Flowent runtime is missing. Reinstall the package and try again.",
  );
  process.exit(1);
}

if (
  startsServer(passthroughArgs) &&
  !existsSync(join(staticDirectory, "index.html"))
) {
  console.error(
    "Flowent application files are missing. Reinstall the package and try again.",
  );
  process.exit(1);
}

const uvCommand = process.env.FLOWENT_UV_BINARY ?? "uv";
const child = spawn(
  uvCommand,
  ["run", "--project", backendProject, "flowent", ...passthroughArgs],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      FLOWENT_STATIC_DIR: staticDirectory,
    },
  },
);

child.on("error", (error) => {
  console.error(error.message);
  console.error("Install uv and try again: https://docs.astral.sh/uv/");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }

  process.exit(code ?? 0);
});
