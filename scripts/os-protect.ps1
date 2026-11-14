param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($request.value)
  $entropy = [Text.Encoding]::UTF8.GetBytes($request.purpose)
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($Mode -eq 'Protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,$scope) }
  else { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,$scope) }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('OS protection failed'); exit 1 }
