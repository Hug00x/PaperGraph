import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const standaloneDirectory = path.join(projectDirectory, ".next", "standalone");
const standaloneNextDirectory = path.join(standaloneDirectory, ".next");
const standaloneNodeModulesDirectory = path.join(standaloneDirectory, "node_modules");

function copyDirectory(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Missing source directory: ${source}`);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

function createIcoFromPng(source, target) {
  const pngBuffer = readFileSync(source);
  const pngSignature = "89504e470d0a1a0a";

  if (pngBuffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`Icon source is not a PNG file: ${source}`);
  }

  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  const header = Buffer.alloc(22);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(header.length, 18);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, Buffer.concat([header, pngBuffer]));
}

function toPowerShellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createWindowsIconPng(source, target) {
  const script = `
$SourcePath = ${toPowerShellString(source)}
$TargetPath = ${toPowerShellString(target)}
Add-Type -AssemblyName System.Drawing
$size = 256
$sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$bitmap.SetResolution(96, 96)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$scale = [Math]::Min($size / $sourceImage.Width, $size / $sourceImage.Height) * 0.9
$drawWidth = [int][Math]::Round($sourceImage.Width * $scale)
$drawHeight = [int][Math]::Round($sourceImage.Height * $scale)
$x = [int][Math]::Round(($size - $drawWidth) / 2)
$y = [int][Math]::Round(($size - $drawHeight) / 2)
$graphics.DrawImage($sourceImage, $x, $y, $drawWidth, $drawHeight)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($TargetPath)) | Out-Null
$bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$sourceImage.Dispose()
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to prepare Windows icon PNG: ${result.stderr || result.stdout}`);
  }
}

function removeStandaloneBuildNoise() {
  const noisyEntries = [
    "build",
    "data",
    "desktop-dist",
    "electron",
    "eslint.config.mjs",
    "package-lock.json",
    "postcss.config.mjs",
    "README.md",
    "scripts",
    "src",
    "supabase",
    "tsconfig.json",
    "tsconfig.tsbuildinfo",
    ".git",
  ];

  for (const entry of noisyEntries) {
    rmSync(path.join(standaloneDirectory, entry), { recursive: true, force: true });
  }

  rmSync(path.join(standaloneNextDirectory, "cache"), { recursive: true, force: true });
}

if (!existsSync(standaloneDirectory)) {
  throw new Error("Next standalone output was not found. Run `npm run build` first.");
}

removeStandaloneBuildNoise();

copyDirectory(
  path.join(projectDirectory, ".next", "static"),
  path.join(standaloneNextDirectory, "static"),
);

copyDirectory(
  path.join(projectDirectory, "public"),
  path.join(standaloneDirectory, "public"),
);

copyDirectory(
  path.join(projectDirectory, "node_modules", "@node-latex-compiler", "bin-win32-x64"),
  path.join(standaloneNodeModulesDirectory, "@node-latex-compiler", "bin-win32-x64"),
);

const windowsIconPngPath = path.join(projectDirectory, "build", "papergraph-icon.png");

createWindowsIconPng(
  path.join(projectDirectory, "src", "imagens", "PapergraphLogo.png"),
  windowsIconPngPath,
);
createIcoFromPng(windowsIconPngPath, path.join(projectDirectory, "build", "papergraph-icon.ico"));

console.log("Electron standalone bundle prepared.");
