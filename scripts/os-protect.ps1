param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
try {
  [void][Reflection.Assembly]::LoadWithPartialName('System.Security')
  [void][Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
  $request = [Web.Script.Serialization.JavaScriptSerializer]::new().DeserializeObject([Console]::In.ReadToEnd())
  $bytes = [Convert]::FromBase64String($request.value)
  $entropy = [Text.Encoding]::UTF8.GetBytes($request.purpose)
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($Mode -eq 'Protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,$scope) }
  else { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,$scope) }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('OS protection failed'); exit 1 }
