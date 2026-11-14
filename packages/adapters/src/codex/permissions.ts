export function permissionConfig(root: string, readOnly: boolean) {
  return {
    default_permissions: 'ceston',
    web_search: 'disabled',
    features: { apps: false, plugins: false, browser_use: false, computer_use: false },
    mcp_servers: {},
    permissions: { ceston: {
      description: 'cestOn registered workspace only',
      filesystem: { glob_scan_max_depth: 32, ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny',
        [root]: { '.': readOnly ? 'read' : 'write', '.git': 'read', '.agents': 'read', '.codex': 'read', '.claude': 'read', '.env': 'deny', '**/.env*': 'deny', '**/*.pem': 'deny', '**/*.key': 'deny' } },
      network: { enabled: false },
    } },
  };
}
