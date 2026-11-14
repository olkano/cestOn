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
  $readback = Get-Acl -LiteralPath $Root
  if ($readback.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Wrong owner' }
  $rules = $readback.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
  if ($rules.Count -lt 1) { throw 'No access rules' }
  foreach ($entry in $rules) { if ($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Value -ne $sid.Value) { throw 'Additional identity has access' } }
  [Console]::Out.Write('{"ownerOnly":true}')
} catch { [Console]::Error.Write('Owner-only data access check failed'); exit 1 }
