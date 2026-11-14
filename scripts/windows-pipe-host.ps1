param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,160}$')][string]$PipeName)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
. ([IO.Path]::Combine($PSScriptRoot,'windows-compile.ps1'))
$source = @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class CestonOwnerPipe {
  private static readonly object OutputLock = new object();
  private static readonly ConcurrentDictionary<string, NamedPipeServerStream> Connections = new ConcurrentDictionary<string, NamedPipeServerStream>();
  private static readonly ManualResetEventSlim Ready = new ManualResetEventSlim(false);
  private static Exception StartupError;
  private static bool Running = true;
  private static NamedPipeServerStream Listener;
  public static void Start(string name) {
    Task.Run(() => Accept(name));
    if (!Ready.Wait(7000)) throw new Exception("Owner-only pipe startup timeout");
    if (StartupError != null) throw StartupError;
    lock (OutputLock) Console.WriteLine("{\"type\":\"ready\",\"ownerOnly\":true}");
  }
  private static void Accept(string name) {
    try {
      var owner = WindowsIdentity.GetCurrent().User;
      while (Running) {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.SetOwner(owner);
        security.AddAccessRule(new PipeAccessRule(owner, PipeAccessRights.FullControl, AccessControlType.Allow));
        var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 16, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security);
        Listener = pipe;
        var acl = pipe.GetAccessControl();
        var rules = acl.GetAccessRules(true, true, typeof(SecurityIdentifier));
        if (!acl.AreAccessRulesProtected || rules.Count != 1 || rules[0].IdentityReference.Value != owner.Value || ((PipeAccessRule)rules[0]).AccessControlType != AccessControlType.Allow) throw new Exception("Owner-only pipe ACL verification failed");
        Ready.Set();
        pipe.WaitForConnection();
        Task.Run(() => Receive(pipe));
      }
    } catch (Exception e) { StartupError = e; Ready.Set(); if (Running) Environment.Exit(2); }
  }
  private static void Receive(NamedPipeServerStream pipe) {
    try {
      var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true);
      var buffer = new StringBuilder();
      while (true) {
        int c = reader.Read();
        if (c < 0 || c == 10) break;
        if (buffer.Length >= 1048576) throw new IOException("Request too large");
        buffer.Append((char)c);
      }
      reader.Dispose();
      if (buffer.Length == 0) { pipe.Dispose(); return; }
      var id = Guid.NewGuid().ToString();
      Connections[id] = pipe;
      var serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 2097152;
      var packet = new Dictionary<string, object> { {"type", "request"}, {"bridgeId", id}, {"body", buffer.ToString()} };
      lock (OutputLock) Console.WriteLine(serializer.Serialize(packet));
    } catch { pipe.Dispose(); }
  }
  public static void Respond(string line) {
    var serializer = new JavaScriptSerializer();
    serializer.MaxJsonLength = 2097152;
    var packet = serializer.Deserialize<Dictionary<string, object>>(line);
    NamedPipeServerStream pipe;
    if (!Connections.TryRemove((string)packet["bridgeId"], out pipe)) return;
    try {
      using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true)) {
        writer.WriteLine((string)packet["body"]);
        writer.Flush();
      }
    } catch (IOException) { } finally { pipe.Dispose(); }
  }
  public static void Stop() {
    Running = false;
    if (Listener != null) Listener.Dispose();
    foreach (var pipe in Connections.Values) pipe.Dispose();
    Connections.Clear();
  }
}
'@
Add-CestonType $source @('System','System.Core','System.Web.Extensions')
[CestonOwnerPipe]::Start($PipeName)
try {
  while ($true) { $line = [Console]::ReadLine(); if ($null -eq $line) { break }; [CestonOwnerPipe]::Respond($line) }
} finally { [CestonOwnerPipe]::Stop() }
