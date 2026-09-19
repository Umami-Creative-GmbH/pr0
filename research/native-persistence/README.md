# Native persistence research harness

See [the evidence report](../../docs/research/native-persistence-validation.md).

From this directory on Windows with Rust/MSVC build tools:

```powershell
cargo run --locked
```

This standalone throwaway binary uses generated SQLite fixtures and uniquely named generated Windows credentials. It kills only its own validation child processes. Fixtures stay in ignored `run-data/`; generated credential records are deleted and checked absent. It does not simulate power loss, reboot Windows, fill a physical disk, enumerate existing credentials, or integrate with Tauri. It must not be imported as production storage code.
