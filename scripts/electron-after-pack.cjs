const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

module.exports = async function copyStandaloneDependencies(context) {
  const projectDirectory = context.packager.projectDir;
  const source = path.join(projectDirectory, ".next", "standalone", "node_modules");
  const target = path.join(context.appOutDir, "resources", "server", "node_modules");

  if (!existsSync(source)) {
    throw new Error("Next standalone node_modules was not found. Run `npm run build` first.");
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
};
