import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "electron/embedding-runtime-config.json"), "utf8"));
const buildRoot = path.join(root, "build");
const destination = path.join(buildRoot, "ollama");
const cache = path.join(buildRoot, "runtime-downloads");
const archive = path.join(cache, `${config.version}-${config.archive}`);
const manifest = path.join(destination, "papergraph-runtime.json");
const runtimeNotices = `PaperGraph bundles Ollama 0.34.3 from the official Windows x64 archive.
Ollama is licensed under MIT; its full license is preserved as OLLAMA-LICENSE.txt.
The upstream archive and dependency notices remain beside the runtime files.
NVIDIA CUDA and Microsoft Visual C++ runtime components retain their upstream terms.
The BGE-M3 model is downloaded separately on first use and is not included in the installer.
See the upstream Ollama, CUDA, Microsoft, and BGE-M3 distributions for their applicable terms.
`;
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function preserveNotices() {
  await writeFile(path.join(destination, "THIRD-PARTY-NOTICES.txt"), runtimeNotices);
  const documents = {
    "CUDA-12.8-EULA.html": "https://docs.nvidia.com/cuda/archive/12.8.1/eula/index.html",
    "CUDA-13.0-EULA.html": "https://docs.nvidia.com/cuda/archive/13.0.0/eula/index.html",
    "MICROSOFT-VC-RUNTIME-TERMS.html": "https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/",
  };
  for (const [name, url] of Object.entries(documents)) {
    if (existsSync(path.join(destination, name))) continue;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Could not preserve runtime license: ${name}`);
    await writeFile(path.join(destination, name), await response.text());
  }
}
if (process.platform !== "win32") throw new Error("This runtime package targets Windows x64 only.");
if (existsSync(manifest) && existsSync(path.join(destination, "ollama.exe"))) {
  const previous = JSON.parse(await readFile(manifest, "utf8"));
  if (previous.version === config.version && previous.sha256 === config.sha256 &&
      previous.executableSha256 === await digest(path.join(destination, "ollama.exe"))) {
    await preserveNotices();
    console.log(`Ollama ${config.version}: prepared runtime verified.`);
    process.exit(0);
  }
}
await mkdir(cache, { recursive: true });
if (!existsSync(archive) || await digest(archive) !== config.sha256) {
  console.log(`Downloading official Ollama ${config.version} Windows runtime...`);
  const response = await fetch(`https://github.com/ollama/ollama/releases/download/v${config.version}/${config.archive}`, {
    signal: AbortSignal.timeout(3600000),
  });
  if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${archive}.partial`));
  if (await digest(`${archive}.partial`) !== config.sha256) throw new Error("Ollama archive SHA-256 mismatch; refusing to extract.");
  await rename(`${archive}.partial`, archive);
}
const listing = spawnSync("tar.exe", ["-tf", archive], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (listing.status !== 0) throw new Error(`Could not inspect official archive: ${listing.stderr}`);
for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
  if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) throw new Error("Unsafe archive entry");
}
// Only clear our build output, never an installed runtime or a user's model directory.
if (!destination.startsWith(buildRoot + path.sep)) throw new Error("Invalid runtime output path");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
console.log("Checksum verified. Extracting standalone runtime and bundled notices...");
const extraction = spawnSync("tar.exe", ["-xf", archive, "-C", destination], { windowsHide: true, stdio: "inherit" });
if (extraction.status !== 0 || !existsSync(path.join(destination, "ollama.exe"))) throw new Error("Runtime extraction failed");
const license = await fetch(`https://raw.githubusercontent.com/ollama/ollama/v${config.version}/LICENSE`, { signal: AbortSignal.timeout(30000) });
if (!license.ok) throw new Error("Could not retrieve the pinned Ollama license");
await writeFile(path.join(destination, "OLLAMA-LICENSE.txt"), await license.text());
await preserveNotices();
await writeFile(manifest, JSON.stringify({ version: config.version, sha256: config.sha256,
  executableSha256: await digest(path.join(destination, "ollama.exe")) }, null, 2));
console.log(`Ollama ${config.version} prepared at ${destination}. No model is included.`);
