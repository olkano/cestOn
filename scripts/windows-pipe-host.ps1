param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,160}$')][string]$PipeName)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$security = New-Object System.IO.Pipes.PipeSecurity
$security.SetAccessRuleProtection($true, $false)
$security.SetOwner($owner)
$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($owner, [System.IO.Pipes.PipeAccessRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)))
$announced = $false
while ($true) {
  $pipe = New-Object System.IO.Pipes.NamedPipeServerStream($PipeName, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::None, 65536, 65536, $security)
  try {
    $acl = $pipe.GetAccessControl()
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if (!$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $owner.Value -or $rules[0].AccessControlType -ne 'Allow') { throw 'Owner-only named pipe ACL was not established' }
    if (!$announced) { [Console]::WriteLine('{"type":"ready","ownerOnly":true}'); $announced = $true }
    $pipe.WaitForConnection()
    $reader = New-Object System.IO.StreamReader($pipe, (New-Object System.Text.UTF8Encoding($false)), $false, 4096, $true)
    $writer = New-Object System.IO.StreamWriter($pipe, (New-Object System.Text.UTF8Encoding($false)), 4096, $true)
    $writer.AutoFlush = $true
    try {
      $buffer = New-Object System.Text.StringBuilder
      while ($true) { $character = $reader.Read(); if ($character -lt 0 -or $character -eq 10) { break }; if ($buffer.Length -ge 1048576) { throw 'IPC request exceeds limit' }; [void]$buffer.Append([char]$character) }
      if ($buffer.Length -gt 0) {
        [Console]::WriteLine((@{type='request'; body=$buffer.ToString()} | ConvertTo-Json -Compress))
        $response = [Console]::ReadLine()
        if ($null -eq $response) { exit 0 }
        $writer.WriteLine($response)
      }
    } finally { $reader.Dispose(); $writer.Dispose() }
  } catch [System.IO.IOException] { } finally { $pipe.Dispose() }
}
