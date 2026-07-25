import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

function runProcess(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal
            ? `PyInstaller stopped with ${signal}.`
            : `PyInstaller exited with code ${code}.`,
        ),
      );
    });
  });
}

export async function buildPyinstallerOnedir({
  targetId: expectedTarget,
  projectRoot,
  inputPath,
  outputDir,
  workDir,
  specDir,
  pythonCommand = process.env.FLOWENT_PYTHON ??
    process.env.PYTHON ??
    (process.platform === "win32" ? "python" : "python3"),
  run = runProcess,
}) {
  await Promise.all([
    mkdir(outputDir, { recursive: true }),
    mkdir(workDir, { recursive: true }),
    mkdir(specDir, { recursive: true }),
  ]);
  const root = resolve(projectRoot);
  const args = [
    join(root, "scripts", "package-runtime", "freeze.py"),
    "--project-root",
    root,
    "--input",
    resolve(inputPath),
    "--output",
    resolve(outputDir),
    "--work",
    resolve(workDir),
    "--spec",
    resolve(specDir),
  ];
  await run(pythonCommand, args, {
    cwd: root,
    env: {
      ...process.env,
      PYTHONHASHSEED: "0",
      PYTHONDONTWRITEBYTECODE: "1",
      SOURCE_DATE_EPOCH: "0",
    },
  });
  const applicationDir = join(resolve(outputDir), "flowent");
  await access(applicationDir);
  return { applicationDir, targetId: expectedTarget };
}
