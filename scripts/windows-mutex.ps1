param([Parameter(Mandatory=$true)][ValidatePattern('^ceston-[a-f0-9]{64}$')][string]$Name)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Security.AccessControl;
using System.Security.Principal;
public static class CestonMutex {
  public static void Run(string name) {
    var owner = WindowsIdentity.GetCurrent().User;
    var security = new MutexSecurity(); security.SetOwner(owner); security.SetAccessRuleProtection(true,false);
    security.AddAccessRule(new MutexAccessRule(owner,MutexRights.FullControl,AccessControlType.Allow));
    bool created; using (var mutex = new Mutex(false,"Global\\" + name,out created,security)) {
      bool locked; try { locked = mutex.WaitOne(0); } catch (AbandonedMutexException) { locked = true; }
      if (!locked) throw new Exception("Installation process already running");
      try { Console.Write("locked\n"); Console.Out.Flush(); while(Console.ReadLine()!=null) {} } finally { mutex.ReleaseMutex(); }
    }
  }
}
'@
[CestonMutex]::Run($Name)
