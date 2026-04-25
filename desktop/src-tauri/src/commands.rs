// Tauri commands — bridge between frontend and native functionality.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// ─── App State ────────────────────────────────────────────────────────────────

pub struct AppState {
    pub server_url: Mutex<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            server_url: Mutex::new("http://localhost:3000".to_string()),
        }
    }
}

// ─── Server URL ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_server_url(state: State<AppState>) -> String {
    state.server_url.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_server_url(state: State<AppState>, url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    *state.server_url.lock().unwrap() = url;
    Ok(())
}

// ─── Secure Credential Storage (OS Keychain) ─────────────────────────────────

#[tauri::command]
pub fn store_credential(service: String, key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_credential(service: String, key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_credential(service: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
        Err(e) => Err(e.to_string()),
    }
}

// ─── System Info ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub version: String,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
