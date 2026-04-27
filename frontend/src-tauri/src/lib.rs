use serde::{Deserialize, Serialize};
use tauri::Manager;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CouncilMember {
    pub name: String,
    pub opinion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeliberateRequest {
    pub prompt: String,
    pub members: Vec<CouncilMember>,
    #[serde(rename = "type")]
    pub request_type: String,
    pub provider: String,   // "anthropic" | "openai"
    pub api_key: String,
    pub model: Option<String>,
}

// ── Anthropic ────────────────────────────────────────────────────────────────

async fn call_anthropic(
    api_key: &str,
    model: &str,
    system: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": [{ "role": "user", "content": user_prompt }]
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic error {status}: {text}"));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let text = data["content"][0]["text"]
        .as_str()
        .ok_or("Unexpected Anthropic response shape")?
        .to_string();
    Ok(text)
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async fn call_openai(
    api_key: &str,
    model: &str,
    system: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_prompt }
        ]
    });

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI error {status}: {text}"));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Unexpected OpenAI response shape")?
        .to_string();
    Ok(text)
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn deliberate(req: DeliberateRequest) -> Result<String, String> {
    if req.api_key.is_empty() {
        return Err("API key not set. Please add it in Settings.".to_string());
    }

    let (system, user_prompt) = if req.request_type == "verdict" {
        let opinions = req
            .members
            .iter()
            .filter_map(|m| m.opinion.as_ref().map(|o| format!("**{}**: {}", m.name, o)))
            .collect::<Vec<_>>()
            .join("\n\n");
        let system = "You are a wise synthesizer. Given multiple AI council member opinions, \
            write a concise verdict that captures the key insights, trade-offs, and a clear recommendation.";
        let prompt = format!(
            "Topic: {}\n\nCouncil opinions:\n{}\n\nProvide a balanced verdict.",
            req.prompt, opinions
        );
        (system.to_string(), prompt)
    } else {
        // "opinion" — member name is in members[0].name
        let name = req.members.first().map(|m| m.name.as_str()).unwrap_or("Advisor");
        let system = format!(
            "You are {name}, an AI council member with a unique perspective. \
            Respond with your genuine opinion — be direct, thoughtful, and true to your character. \
            Keep your response to 2-3 concise paragraphs."
        );
        (system, req.prompt.clone())
    };

    let model = req.model.as_deref();

    match req.provider.as_str() {
        "anthropic" => {
            let m = model.unwrap_or("claude-sonnet-4-6");
            call_anthropic(&req.api_key, m, &system, &user_prompt).await
        }
        "openai" => {
            let m = model.unwrap_or("gpt-4o");
            call_openai(&req.api_key, m, &system, &user_prompt).await
        }
        other => Err(format!("Unknown provider: {other}")),
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![deliberate, get_app_version])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.get_webview_window("main").unwrap().open_devtools();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
