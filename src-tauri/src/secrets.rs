//! The key that encrypts secret variables at rest.
//!
//! Secret-flagged variables used to sit in plain text inside
//! `kapi.workspaces.json`. Now their values live in `kapi.secrets.json`,
//! AES-GCM-encrypted with a random 256-bit key that is stored in the OS
//! credential store (macOS Keychain, Windows Credential Manager, the Secret
//! Service on Linux) — see `src/lib/secretVault.ts` for the file side. A
//! single small entry keeps it to one keychain prompt at most, and avoids
//! Windows' 2.5 KB per-credential limit (a client certificate PEM kept in a
//! secret variable would not fit in one).

const SERVICE: &str = "com.klejdi94.kapi";
const ACCOUNT: &str = "secrets-key";

fn is_key(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

fn new_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("Could not generate a key: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn load_or_create() -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) if is_key(&key) => Ok(key),
        Ok(_) => Err("The stored secrets key is malformed".into()),
        // Only a genuinely missing entry creates a new key. Any other error —
        // a denied keychain prompt, a locked keyring, no Secret Service on
        // this Linux desktop — must not, or the old key (and every secret
        // encrypted with it) would be lost.
        Err(keyring::Error::NoEntry) => {
            let key = new_key()?;
            entry.set_password(&key).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn kapi_secrets_key() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(load_or_create)
        .await
        .map_err(|e| format!("Keychain task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_are_256_bit_hex_and_unique() {
        let a = new_key().unwrap();
        let b = new_key().unwrap();
        assert!(is_key(&a) && is_key(&b));
        assert_ne!(a, b);
    }

    #[test]
    fn rejects_malformed_keys() {
        assert!(!is_key("abc"));
        assert!(!is_key(&"z".repeat(64)));
    }
}
