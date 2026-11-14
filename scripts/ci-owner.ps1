$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Disposable Windows Actions runner required' }
$workspace = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
if ($workspace -ne [IO.Path]::GetFullPath((Get-Location).Path)) { throw 'Wrong checkout' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
[Console]::WriteLine('{"stage":"runner-owner","defaultOwnerMatchesUser":' + ($identity.Owner.Value -eq $identity.User.Value).ToString().ToLowerInvariant() + '}')
# The existing runner user retains its identity/profile. Only this child loses administrator authority.
& "$env:SystemRoot\System32\icacls.exe" $workspace /grant ('*' + $identity.User.Value + ':(OI)(CI)F') /quiet
if ($LASTEXITCODE -ne 0) { throw 'Could not grant the checkout to its runner user' }
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
public static class CestonCiOwner {
  [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedBytes;
    public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr process,IntPtr source,IntPtr target,out IntPtr copy,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint disabledCount,ref SidAttributes disabled,uint privilegeCount,IntPtr privileges,uint restrictedCount,IntPtr restricted,out IntPtr result);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int information,IntPtr value,int length);
  [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUser(IntPtr token,string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo process);
  static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static IntPtr Sid(SecurityIdentifier sid) { byte[] bytes=new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes,0); IntPtr memory=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,memory,bytes.Length); return memory; }
  static void TokenData(IntPtr token,int kind,IntPtr sid,uint attributes,bool ownerOnly) {
    var value=new SidAttributes { Sid=sid, Attributes=attributes }; int length=ownerOnly ? IntPtr.Size : Marshal.SizeOf(value)+(int)GetLengthSid(sid); IntPtr memory=Marshal.AllocHGlobal(Math.Max(length,Marshal.SizeOf(value)));
    try { Marshal.StructureToPtr(value,memory,false); Check(SetTokenInformation(token,kind,memory,length)); }
    finally { Marshal.FreeHGlobal(memory); }
  }
  public static int Run(string node,string script,string directory) {
    IntPtr original=IntPtr.Zero,restricted=IntPtr.Zero,admin=IntPtr.Zero,user=IntPtr.Zero,medium=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero;
    var process=new ProcessInfo();
    try {
      Check(OpenProcessToken(GetCurrentProcess(),0x008b,out original));
      admin=Sid(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null));
      var disabled=new SidAttributes { Sid=admin,Attributes=0 }; Check(CreateRestrictedToken(original,1,1,ref disabled,0,IntPtr.Zero,0,IntPtr.Zero,out restricted));
      user=Sid(WindowsIdentity.GetCurrent().User); TokenData(restricted,4,user,0,true);
      medium=Sid(new SecurityIdentifier("S-1-16-8192")); TokenData(restricted,25,medium,0x20,false);
      Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(-10),GetCurrentProcess(),out input,0,true,2));
      Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(-11),GetCurrentProcess(),out output,0,true,2));
      Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(-12),GetCurrentProcess(),out error,0,true,2));
      var start=new Startup { cb=Marshal.SizeOf(typeof(Startup)),flags=0x100,input=input,output=output,error=error };
      Check(CreateProcessAsUser(restricted,node,new StringBuilder("\""+node+"\" \""+script+"\""),IntPtr.Zero,IntPtr.Zero,true,0x08000000,IntPtr.Zero,directory,ref start,out process));
      if (WaitForSingleObject(process.process,25*60*1000)!=0) { TerminateProcess(process.process,1); throw new Exception("Owned CI process exceeded its budget"); }
      uint code; Check(GetExitCodeProcess(process.process,out code)); return (int)code;
    } finally {
      foreach(var handle in new[]{process.thread,process.process,input,output,error,restricted,original}) if(handle!=IntPtr.Zero) CloseHandle(handle);
      foreach(var pointer in new[]{admin,user,medium}) if(pointer!=IntPtr.Zero) Marshal.FreeHGlobal(pointer);
    }
  }
}
'@
$node = (Get-Command node.exe).Source
$code = [CestonCiOwner]::Run($node,[IO.Path]::Combine($workspace,'scripts/ci-owner.mjs'),$workspace)
if ($code -ne 0) { throw "Owner verification failed with exit code $code" }
