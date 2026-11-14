param([ValidateSet('Install','Uninstall')][string]$Mode, [string]$TaskName, [string]$Node, [string]$Script, [string]$Root, [string]$InstallationId)
$ErrorActionPreference = 'Stop'
if ($TaskName -ne "cestOn-$InstallationId" -or $InstallationId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid installation identity' }
foreach ($value in @($Node,$Script,$Root)) { if ($value.Contains('"') -or $value.Contains("`n") -or $value.Contains("`r")) { throw 'Unsafe task argument' } }
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '"' + $Script + '" start --root "' + $Root + '"'
$description = "cestOn installation $InstallationId"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Description -ne $description -or $existing.Principal.UserId -ne $owner -or $existing.Actions.Execute -ne $Node -or $existing.Actions.Arguments -ne $arguments) { throw 'Existing task does not match this installation' }
}
if ($Mode -eq 'Uninstall') { if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }; if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Task removal did not persist' }; exit }
if (!$existing) {
  $action = New-ScheduledTaskAction -Execute $Node -Argument $arguments -WorkingDirectory (Join-Path $Root 'supervisor/runtime')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $owner
  $principal = New-ScheduledTaskPrincipal -UserId $owner -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description | Out-Null
}
$verified = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($verified.Description -ne $description -or $verified.Principal.UserId -ne $owner -or $verified.Actions.Execute -ne $Node -or $verified.Actions.Arguments -ne $arguments) { throw 'Startup task read-back failed' }
