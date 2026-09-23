$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.utmp'))
$installPath = [IO.Path]::GetFullPath((Join-Path $testRoot 'installed-validation'))
if (-not $installPath.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Installation test path must stay inside the workspace temporary directory'
}
$installer = Join-Path $testRoot 'installer-validation\PaperGraph-Installer-Validation.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Build the validation installer first' }
function Get-PaperGraphInstallations {
  $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
  try {
    foreach ($name in $root.GetSubKeyNames()) {
      $key = $root.OpenSubKey($name)
      try {
        if ($key.GetValue('DisplayName') -like '*PaperGraph*') {
          [pscustomobject]@{ Key=$name; Name=$key.GetValue('DisplayName'); Uninstall=$key.GetValue('UninstallString') }
        }
      } finally { $key.Close() }
    }
  } finally { $root.Close() }
}
$before = @(Get-PaperGraphInstallations)
if ($before.Name -like '*Installer Validation*') { throw 'A validation installation already exists; inspect it before continuing' }
$modelPath = Join-Path $testRoot 'packaged-profile\local\PaperGraph\ollama\models'
$manifest = @(Get-ChildItem -LiteralPath (Join-Path $modelPath 'manifests') -Recurse -File | Select-Object -First 1)
if ($manifest.Count -ne 1) { throw 'Run the packaged application smoke test first' }
$modelHash = (Get-FileHash -LiteralPath $manifest[0].FullName -Algorithm SHA256).Hash
function Install-Validation {
  # NSIS requires /D last and unquoted; Start-Process passes this exact command line.
  $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installPath" -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $installPath 'resources\ollama\ollama.exe'))) { throw 'Installed runtime missing' }
  if (-not (Test-Path -LiteralPath (Join-Path $installPath 'resources\app.asar.unpacked\electron\ollama-guardian.ps1'))) { throw 'Installed guardian missing' }
}
Install-Validation
$installed = @(Get-PaperGraphInstallations | Where-Object Name -Like '*Installer Validation*')
if ($installed.Count -ne 1) { throw 'Expected exactly one separate validation registration' }
Write-Output 'Validation installer: runtime and guardian installed'
Install-Validation
if ((Get-FileHash -LiteralPath $manifest[0].FullName -Algorithm SHA256).Hash -ne $modelHash) { throw 'Model changed during reinstall' }
Write-Output 'Validation reinstall: existing model preserved'
$uninstallers = @(Get-ChildItem -LiteralPath $installPath -Filter '*Uninstall*.exe' -File)
if ($uninstallers.Count -ne 1) { throw 'Expected one validation uninstaller' }
if (-not $uninstallers[0].FullName.StartsWith($installPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to execute an uninstaller outside the validated test directory'
}
$process = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList "/S _?=$installPath" -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
if (Test-Path -LiteralPath (Join-Path $installPath 'resources\ollama\ollama.exe')) { throw 'Runtime remains after uninstall' }
if ((Get-FileHash -LiteralPath $manifest[0].FullName -Algorithm SHA256).Hash -ne $modelHash) { throw 'Model changed during uninstall' }
$after = @(Get-PaperGraphInstallations)
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) { throw 'Original installation registrations changed' }
Write-Output 'Validation uninstall: runtime removed, model and original installation preserved'
@{ installed=$true; reinstalled=$true; runtimeRemoved=$true; modelPreserved=$true; originalInstallationPreserved=$true; identity='com.papergraph.installer-validation' } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'nsis-validation-result.json') -Encoding UTF8
