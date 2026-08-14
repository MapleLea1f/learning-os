import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const subcommand = process.argv[2];
const supportedCommands = new Set(["dev", "build", "start"]);

if (!supportedCommands.has(subcommand)) {
  throw new Error(`Unsupported Vinext command: ${subcommand}`);
}

const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const connectorPath = fileURLToPath(new URL("./learning-os-workspace.mjs", import.meta.url));

const connectorChild = subcommand === "dev" || subcommand === "start"
  ? spawn(process.execPath, [connectorPath, "serve"], { cwd: process.cwd(), stdio: "ignore", windowsHide: true, env: { ...process.env, LEARNING_OS_ROOT: process.env.LEARNING_OS_ROOT ?? process.cwd() } })
  : null;

const child = spawn(process.execPath, [cliPath, subcommand], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    LEARNING_OS_ROOT: process.env.LEARNING_OS_ROOT ?? process.cwd(),
  },
});

child.once("error", (error) => {
  console.error("Unable to start Vinext:", error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  connectorChild?.kill();
  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 1);
});
