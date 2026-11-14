param([Parameter(Mandatory=$true)][string]$Root, [ValidateSet('Set','Check')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
try {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($Mode -eq 'Set') {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($Root,$acl)
  }
  function Check-PrivatePath([string]$Path) {
    $attributes = [IO.File]::GetAttributes($Path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Private path link' }
    $readback = if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) { [IO.Directory]::GetAccessControl($Path) } else { [IO.File]::GetAccessControl($Path) }
    if ($readback.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Wrong owner' }
    $rules = $readback.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
    if ($rules.Count -lt 1) { throw 'No access rules' }
    foreach ($entry in $rules) { if ($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Value -ne $sid.Value) { throw 'Additional identity has access' } }
  }
  Check-PrivatePath $Root
  $pending = [Collections.Generic.Stack[string]]::new()
  foreach ($name in @('state','supervisor','backups')) { $path = [IO.Path]::Combine($Root,$name); if ([IO.Directory]::Exists($path)) { $pending.Push($path) } }
  $visited = 0
  while ($pending.Count -gt 0) {
    $path = $pending.Pop(); $visited++; if ($visited -gt 10000) { throw 'Private inspection limit' }
    Check-PrivatePath $path
    if ([IO.Directory]::Exists($path)) {
      foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($path)) {
        if ($path -eq [IO.Path]::Combine($Root,'supervisor') -and [IO.Path]::GetFileName($child) -eq 'runtime') { continue }
        $pending.Push($child)
      }
    }
  }
  [Console]::Out.Write('{"ownerOnly":true}')
} catch { [Console]::Error.Write('Owner-only data access check failed'); exit 1 }
