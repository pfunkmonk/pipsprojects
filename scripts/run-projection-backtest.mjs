import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const scriptPath = join(repositoryRoot, "scripts", "backtest-projection-ensemble.py");
const explicitPython = String(process.env.THUNDER_BOWL_PYTHON || "").trim();
const candidates = [
  explicitPython,
  join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
  process.platform === "win32" ? "python" : "python3",
  "python",
].filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);

function supportsBacktest(python) {
  const check = spawnSync(python, ["-c", "import numpy, pandas"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return !check.error && check.status === 0;
}

const python = candidates.find(supportsBacktest);
if (!python) {
  console.error(
    "Projection backtest dependencies are unavailable. Run "
    + "`python -m pip install -r requirements-backtests.txt`, or set "
    + "THUNDER_BOWL_PYTHON to a Python executable with numpy and pandas.",
  );
  process.exit(1);
}

const result = spawnSync(python, [scriptPath, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(`Projection backtest failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
