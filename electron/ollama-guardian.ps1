param([string]$Executable, [string]$WorkingDirectory, [int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
# A Windows Job Object owns ONLY the process we launch and its descendants.
# If this guardian is terminated/crashes, Windows closes the job and kills its tree.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PaperGraphJob {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint n);
  [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max;
    public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong R1,R2,R3,R4,R5,R6; }
  [StructLayout(LayoutKind.Sequential)] public struct Extended {
    public Basic Basic; public IO IO; public UIntPtr P1,P2,P3,P4;
  }
  public static IntPtr Open() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    Extended info = new Extended(); info.Basic.Flags = 0x2000;
    int size = Marshal.SizeOf(info); IntPtr buffer = Marshal.AllocHGlobal(size);
    try { Marshal.StructureToPtr(info, buffer, false);
      if(job == IntPtr.Zero || !SetInformationJobObject(job, 9, buffer, (uint)size)) {
        if(job != IntPtr.Zero) CloseHandle(job); throw new Exception("Could not create runtime job");
      }
    } finally { Marshal.FreeHGlobal(buffer); }
    return job;
  }
}
'@
$owner = [System.Diagnostics.Process]::GetProcessById($OwnerProcessId)
$job = [PaperGraphJob]::Open()
$runtime = $null
try {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.Arguments = 'serve'
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $runtime = [System.Diagnostics.Process]::Start($info)
  if (-not [PaperGraphJob]::AssignProcessToJobObject($job, $runtime.Handle)) {
    $runtime.Kill()
    throw 'Could not isolate the runtime process tree'
  }
  Write-Output ('PAPERGRAPH_RUNTIME_PID=' + $runtime.Id)
  while (-not $owner.WaitForExit(500)) {
    if ($runtime.HasExited) { exit $runtime.ExitCode }
  }
} finally {
  [PaperGraphJob]::CloseHandle($job) | Out-Null
  if ($runtime) { $runtime.Dispose() }
  $owner.Dispose()
}
