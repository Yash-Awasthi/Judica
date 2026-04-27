# judica Desktop

Cross-platform desktop application built with [Tauri 2](https://v2.tauri.app/).

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js 20+](https://nodejs.org/)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk-4.1`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
  - **Windows**: Visual Studio Build Tools, WebView2

## Development

```bash
# From project root
cd desktop

# Install frontend deps (if not already done)
cd ../frontend && npm install && cd ../desktop

# Run in development mode
cargo tauri dev
```

## Build

```bash
# Build for current platform
cargo tauri build

# Output in desktop/src-tauri/target/release/bundle/
```

## Features

- **Native window** with system chrome
- **Secure credential storage** via OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Auto-update** support via Tauri updater plugin
- **Deep links** (`judica://` protocol)
- **System notifications**
- **Clipboard** integration
- **DevTools** in debug builds

## Architecture

```
desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs       # App entry point + plugin setup
│   │   └── commands.rs    # Tauri IPC commands
│   ├── Cargo.toml         # Rust dependencies
│   ├── tauri.conf.json    # Tauri configuration
│   └── build.rs           # Build script
```

The desktop app wraps the existing frontend (`frontend/dist`) in a native WebView window. All API calls go through the configured server URL (default: `http://localhost:3000`).
