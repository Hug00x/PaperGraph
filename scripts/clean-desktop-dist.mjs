import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const desktopDistDirectory = path.join(projectDirectory, "desktop-dist");

rmSync(desktopDistDirectory, { recursive: true, force: true });
console.log("Desktop build output cleaned.");
