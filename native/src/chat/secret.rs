//! Secrets at rest (API key, WeChat bot token): Windows DPAPI, bound to this Windows account.
//! Also reads the Electron build's safeStorage values (Chromium os_crypt: "v10" + AES-256-GCM,
//! the AES key itself DPAPI-protected in "Local State"), so a key saved there carries over.
use base64::Engine;
use std::path::Path;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        let ok = if protect {
            CryptProtectData(&input, windows::core::w!("bluefish"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        ok.ok()?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as _));
        Some(v)
    }
}
#[cfg(not(windows))]
fn dpapi(_: &[u8], _: bool) -> Option<Vec<u8>> {
    None
}

pub fn available() -> bool {
    dpapi(b"x", true).is_some()
}
pub fn protect(text: &str) -> Option<String> {
    dpapi(text.as_bytes(), true).map(|v| B64.encode(v))
}
pub fn unprotect(b64: &str) -> Option<String> {
    let raw = B64.decode(b64.trim()).ok()?;
    String::from_utf8(dpapi(&raw, false)?).ok()
}

/// Decrypts an Electron `safeStorage.encryptString()` value (base64), given that app's user-data
/// folder (which holds "Local State").
pub fn electron_decrypt(user_data: &Path, b64: &str) -> Option<String> {
    use aes_gcm::aead::{Aead, KeyInit};
    let raw = B64.decode(b64.trim()).ok()?;
    if raw.len() < 3 + 12 + 16 {
        return None;
    }
    if &raw[..3] != b"v10" {
        // Older builds stored a plain DPAPI blob.
        return String::from_utf8(dpapi(&raw, false)?).ok();
    }
    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(user_data.join("Local State")).ok()?).ok()?;
    let wrapped = B64.decode(state["os_crypt"]["encrypted_key"].as_str()?).ok()?;
    let key = dpapi(wrapped.strip_prefix(b"DPAPI")?, false)?;
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key).ok()?;
    let nonce = aes_gcm::Nonce::from_slice(&raw[3..15]);
    String::from_utf8(cipher.decrypt(nonce, &raw[15..]).ok()?).ok()
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip() {
        let p = super::protect("sk-test").unwrap();
        assert_eq!(super::unprotect(&p).as_deref(), Some("sk-test"));
    }
}
