param([Parameter(Mandatory=$true)][string]$Root, [ValidateSet('Set','Check')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
try {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($Mode -eq 'Set') {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath $Root -AclObject $acl
  }
  function Check-PrivatePath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Private path link' }
    $readback = Get-Acl -LiteralPath $Path
    if ($readback.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Wrong owner' }
    $rules = $readback.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
    if ($rules.Count -lt 1) { throw 'No access rules' }
    foreach ($entry in $rules) { if ($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Value -ne $sid.Value) { throw 'Additional identity has access' } }
  }
  Check-PrivatePath $Root
  $pending = New-Object 'Collections.Generic.Stack[string]'
  foreach ($name in @('state','supervisor','backups')) { $path = Join-Path $Root $name; if (Test-Path -LiteralPath $path) { $pending.Push($path) } }
  $visited = 0
  while ($pending.Count -gt 0) {
    $path = $pending.Pop(); $visited++; if ($visited -gt 10000) { throw 'Private inspection limit' }
    Check-PrivatePath $path
    if (Test-Path -LiteralPath $path -PathType Container) {
      foreach ($child in Get-ChildItem -LiteralPath $path -Force) {
        if ($path -eq (Join-Path $Root 'supervisor') -and $child.Name -eq 'runtime') { continue }
        $pending.Push($child.FullName)
      }
    }
  }
  [Console]::Out.Write('{"ownerOnly":true}')
} catch { [Console]::Error.Write('Owner-only data access check failed'); exit 1 }
