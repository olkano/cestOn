param([Parameter(Mandatory=$true)][string]$DataRoot)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $DataRoot
if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected a real directory' }
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security = New-Object Security.AccessControl.DirectorySecurity
$security.SetOwner($owner)
$security.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$security.AddAccessRule($rule)
Set-Acl -LiteralPath $DataRoot -AclObject $security
$actual = Get-Acl -LiteralPath $DataRoot
$rules = $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
if (!$actual.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $owner.Value) { throw 'Private data root ACL verification failed' }
[Console]::WriteLine('{"ownerOnly":true}')
