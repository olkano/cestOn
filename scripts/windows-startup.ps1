param([ValidateSet('Install','Uninstall')][string]$Mode, [string]$TaskName, [string]$Node, [string]$Script, [string]$Root, [string]$InstallationId)
$ErrorActionPreference = 'Stop'
if ($TaskName -ne "cestOn-$InstallationId" -or $InstallationId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid installation identity' }
foreach ($value in @($Node,$Script,$Root)) { if ($value.Contains('"') -or $value.Contains("`n") -or $value.Contains("`r")) { throw 'Unsafe task argument' } }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$owner = $identity.Name
$arguments = '"' + $Script + '" start --root "' + $Root + '"'
$description = "cestOn installation $InstallationId"
# Task Scheduler reads a local account back without its computer name, so the owner is compared by SID.
function Test-OwnTask($task) {
  try { $sid = ([Security.Principal.NTAccount]$task.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]).Value } catch { return $false }
  $actions = @($task.Actions)
  return $task.Description -eq $description -and $sid -eq $identity.User.Value -and $actions.Count -eq 1 -and $actions[0].Execute -eq $Node -and $actions[0].Arguments -eq $arguments
}
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and !(Test-OwnTask $existing)) { throw 'Existing task does not match this installation' }
if ($Mode -eq 'Uninstall') { if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }; if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Task removal did not persist' }; exit }
if (!$existing) {
  $action = New-ScheduledTaskAction -Execute $Node -Argument $arguments -WorkingDirectory (Join-Path $Root 'supervisor/runtime')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $owner
  $principal = New-ScheduledTaskPrincipal -UserId $owner -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description | Out-Null
}
if (!(Test-OwnTask (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop))) { throw 'Startup task read-back failed' }
