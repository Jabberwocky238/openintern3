import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
export * from "./kernel/index.js";
export * from "./service/index.js";
export * from "./application.js";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { PluginLoader } from "./kernel/plugin-loader.js";
import { Application } from "./application.js";

if (existsSync(".env.dev")) {
  dotenv.config({ path: ".env.dev" });
} else if (existsSync(".env")) {
  dotenv.config({ path: ".env" });
}

const application = new Application();
const pluginLoader = new PluginLoader();
const pluginModulePaths = [
  new URL("../plugins/echo/src/index.ts", import.meta.url).href,
  new URL("../plugins/cron/src/index.ts", import.meta.url).href,
  new URL("../plugins/filesystem/src/index.ts", import.meta.url).href,
  new URL("../plugins/agent/src/index.ts", import.meta.url).href,
  new URL("../plugins/terminals/src/index.ts", import.meta.url).href,
  new URL("../plugins/feishu/src/index.ts", import.meta.url).href,
  new URL("../plugins/whatsapp/src/index.ts", import.meta.url).href,
  new URL("../plugins/wecom/src/index.ts", import.meta.url).href,
];

for (const pluginModulePath of pluginModulePaths) {
  const plugin = await pluginLoader.loadFromImport(pluginModulePath);
  await application.registerPlugin(plugin);
}

const terminal = createInterface({
  input: stdin,
  output: stdout,
  prompt: application.getPrompt(),
});

terminal.prompt();

terminal.on("line", async (line) => {
  const output = await application.executeLine(line.trim());

  if (output) {
    stdout.write(`${output}\n`);
  }

  terminal.setPrompt(application.getPrompt());
  terminal.prompt();
});

