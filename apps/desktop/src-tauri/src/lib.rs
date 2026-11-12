//! The native shell. It does two things the web view cannot: read the daemon's client token from the macOS
//! Keychain, and keep tokens for remote daemons in the OS keychain instead of web storage.
//! `DAEMON_ACCOUNT` is only used on macOS, where a local daemon can exist.
//!
//! Everything else (the socket to the daemon, every screen) lives in the web frontend, which is why the same
//! frontend runs unchanged on desktop and on a phone.

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Where the daemon on this Mac keeps the token it created on first boot (see `KeychainVault` in the daemon).
const DAEMON_SERVICE: &str = "studio-zero";
const DAEMON_ACCOUNT: &str = "daemon/client-token";
/// Where this client keeps tokens for daemons it was paired with, one item per host.
const CLIENT_SERVICE: &str = "studio-zero-client";
/// The daemon stores every secret as `sz1:<base64>` so that it is always one printable line.
const ENVELOPE: &str = "sz1:";

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod store {
    use keyring::{Entry, Error};

    pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
        match Entry::new(service, account).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
        Entry::new(service, account)
            .and_then(|entry| entry.set_password(value))
            .map_err(|err| err.to_string())
    }

    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        match Entry::new(service, account).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

/// Platforms without a keychain binding yet: nothing is remembered, and the token is asked for on each launch.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod store {
    pub fn get(_service: &str, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn set(_service: &str, _account: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn delete(_service: &str, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

/// A host name as it appears in the address field: letters, digits, dots, dashes, and a bracketed IPv6 literal.
/// It becomes a keychain account name, so anything else is refused.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
}

fn decode_envelope(stored: &str) -> Result<String, String> {
    let encoded = stored
        .strip_prefix(ENVELOPE)
        .ok_or_else(|| "the keychain item was not written by Studio Zero".to_string())?;
    let bytes = STANDARD.decode(encoded).map_err(|err| err.to_string())?;
    String::from_utf8(bytes).map_err(|err| err.to_string())
}

/// Reads the daemon's keychain item the way the daemon's own CLI does: through `/usr/bin/security`, which is the
/// program on the item's access list. Reading it through the keychain API from this app would make macOS stop
/// and ask for the login password first.
#[cfg(target_os = "macos")]
fn read_daemon_item() -> Result<Option<String>, String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", DAEMON_SERVICE, "-a", DAEMON_ACCOUNT, "-w"])
        .output()
        .map_err(|err| err.to_string())?;
    match output.status.code() {
        Some(0) => Ok(Some(String::from_utf8_lossy(&output.stdout).trim_end().to_string())),
        // 44 is errSecItemNotFound: no daemon has run on this Mac.
        Some(44) => Ok(None),
        _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
    }
}

/// A phone has no local daemon.
#[cfg(not(target_os = "macos"))]
fn read_daemon_item() -> Result<Option<String>, String> {
    Ok(None)
}

/// The client token of the daemon running on this Mac, or `None` when there is no local daemon.
#[tauri::command]
fn local_client_token() -> Result<Option<String>, String> {
    match read_daemon_item()? {
        Some(stored) => decode_envelope(&stored).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
fn load_token(host: String) -> Result<Option<String>, String> {
    if !valid_host(&host) {
        return Err("invalid host".into());
    }
    store::get(CLIENT_SERVICE, &host)
}

#[tauri::command]
fn save_token(host: String, token: String) -> Result<(), String> {
    if !valid_host(&host) {
        return Err("invalid host".into());
    }
    if token.len() < 16 || token.len() > 256 {
        return Err("invalid token".into());
    }
    store::set(CLIENT_SERVICE, &host, &token)
}

#[tauri::command]
fn forget_token(host: String) -> Result<(), String> {
    if !valid_host(&host) {
        return Err("invalid host".into());
    }
    store::delete(CLIENT_SERVICE, &host)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            local_client_token,
            load_token,
            save_token,
            forget_token
        ])
        .run(tauri::generate_context!())
        .expect("Studio Zero could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_restricted_to_what_an_address_can_contain() {
        for good in ["localhost", "127.0.0.1", "macmini.tailnet.ts.net", "[::1]", "studio.example.com:8443"] {
            assert!(valid_host(good), "{good}");
        }
        for bad in ["", "host name", "a/b", "x;rm", "host\n", "\u{d55c}\u{ae00}.example"] {
            assert!(!valid_host(bad), "{bad:?}");
        }
        assert!(!valid_host(&"a".repeat(254)));
    }

    #[test]
    fn the_daemon_envelope_round_trips() {
        // `sz1:` + base64("szc_token-value")
        assert_eq!(decode_envelope("sz1:c3pjX3Rva2VuLXZhbHVl").unwrap(), "szc_token-value");
        assert!(decode_envelope("plain-text-from-elsewhere").is_err());
        assert!(decode_envelope("sz1:not base64!").is_err());
    }
}
