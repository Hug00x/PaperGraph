const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const resources = path.resolve(process.argv[2] || path.join(root, "desktop-dist/win-unpacked/resources"));
const config = require("../electron/embedding-runtime-config.json");
async function hash(file) {
  const value = createHash("sha256"); for await (const part of fs.createReadStream(file)) value.update(part);
  return value.digest("hex");
}
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, "ollama/papergraph-runtime.json"), "utf8"));
  assert.equal(manifest.version, config.version);
  assert.equal(manifest.sha256, config.sha256);
  assert.equal(await hash(path.join(resources, "ollama/ollama.exe")), manifest.executableSha256);
  assert.ok(fs.existsSync(path.join(resources, "app.asar.unpacked/electron/ollama-guardian.ps1")));
  assert.ok(!fs.existsSync(path.join(resources, "server/.env.local")));
  assert.ok(!fs.existsSync(path.join(resources, "ollama/models")));
  for (const file of ["OLLAMA-LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "CUDA-12.8-EULA.html", "CUDA-13.0-EULA.html", "MICROSOFT-VC-RUNTIME-TERMS.html"]) {
    assert.ok(fs.statSync(path.join(resources, "ollama", file)).size > 100);
  }
  const envPath = path.join(root, ".env.local");
  const secrets = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((line) => /^(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|PAPERGRAPH_OPENAI_API_KEY)=/.test(line))
    .map((line) => Buffer.from(line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")))
    .filter((value) => value.length > 12) : [];
  let checked = 0;
  async function scan(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) { if (item.name !== "ollama") await scan(file); }
      else if (/\.(?:asar|js|cjs|mjs|json|map|txt|html)$/.test(item.name) || item.name.startsWith(".env")) {
        let tail = Buffer.alloc(0); const overlap = Math.max(1, ...secrets.map((value) => value.length));
        for await (const chunk of fs.createReadStream(file)) {
          const data = Buffer.concat([tail, chunk]);
          assert.ok(!secrets.some((secret) => data.includes(secret)), `Private build secret found in ${path.relative(resources, file)}`);
          tail = data.subarray(-overlap);
        }
        checked++;
      }
    }
  }
  await scan(resources);
  console.log(JSON.stringify({ runtimeChecksum: "verified", guardianUnpacked: true, licensesIncluded: true,
    modelBundled: false, privateBuildSecretsFound: false, filesChecked: checked }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
