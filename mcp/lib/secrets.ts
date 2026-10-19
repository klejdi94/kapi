import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptVault, injectSecrets, referencesVault, type SecretMap } from '@/lib/secretVault';
import { dataDir } from './dataDir.ts';

/**
 * Reads the app's encrypted secret variables so a test run started from an AI
 * CLI authenticates the same way one started in the app does. The key lives in
 * the OS credential store under the entry `src-tauri/src/secrets.rs` creates;
 * this process has no native keychain binding, so it asks the OS's own tool.
 * On macOS that shows a one-time "security wants to access…" prompt the user
 * can allow. Any failure just means secrets stay blank — never an error.
 */
const SERVICE = 'com.klejdi94.kapi';
const ACCOUNT = 'secrets-key';

function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

// keyring's Windows backend stores a generic credential named "<user>.<service>"
// whose blob is the password in UTF-16LE; CredRead is reached through PowerShell.
const WINDOWS_READ = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KapiCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(ptr); }
  }
}
'@
[Console]::Out.Write([KapiCred]::Read('${ACCOUNT}.${SERVICE}'))
`;

export async function readSecretsKey(): Promise<string | null> {
  let key: string | null = null;
  if (process.platform === 'darwin') key = await run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], 60_000);
  else if (process.platform === 'win32') key = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ]);
  else key = await run('secret-tool', ['lookup', 'service', SERVICE, 'username', ACCOUNT]);
  return key && /^[0-9a-f]{64}$/i.test(key) ? key : null;
}

async function readVault(): Promise<SecretMap | null> {
  let text: string;
  try {
    text = await readFile(join(dataDir(), 'kapi.secrets.json'), 'utf-8');
  } catch {
    return null;
  }
  const key = await readSecretsKey();
  if (!key) return null;
  try {
    return await decryptVault(text, key);
  } catch {
    return null;
  }
}

/**
 * Returns `state` with secret values filled in from the vault, plus how many
 * couldn't be. Read-only on purpose: the result is for running requests, and
 * must never be written back to the workspace file.
 */
export async function withSecrets<T>(state: T): Promise<{ state: T; missing: number }> {
  const text = JSON.stringify({ state, version: 1 });
  if (!referencesVault(text)) return { state, missing: 0 };
  const vault = await readVault();
  const { text: injected, missing } = injectSecrets(text, vault ?? {});
  return { state: (JSON.parse(injected) as { state: T }).state, missing };
}
