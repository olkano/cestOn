function Add-CestonType([string]$Source, [string[]]$References = @('System','System.Core')) {
  [void][Reflection.Assembly]::LoadWithPartialName('Microsoft.CSharp')
  $compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
  try {
    $parameters = [CodeDom.Compiler.CompilerParameters]::new()
    $parameters.GenerateInMemory = $true
    $parameters.GenerateExecutable = $false
    foreach ($name in $References) {
      $assembly = [Reflection.Assembly]::LoadWithPartialName($name)
      if ($null -eq $assembly) { throw 'Required Windows assembly is unavailable' }
      [void]$parameters.ReferencedAssemblies.Add($assembly.Location)
    }
    $compiled = $compiler.CompileAssemblyFromSource($parameters, $Source)
    if ($compiled.Errors.HasErrors) { throw 'Windows helper compilation failed' }
    [void]$compiled.CompiledAssembly
  } finally { $compiler.Dispose() }
}
