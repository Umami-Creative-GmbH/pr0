// Test-only HTTPS fixture adapter, also used by the real production UI benchmark.
struct SearchFixtureTransport {
    directory: std::path::PathBuf,
    fallback: Arc<dyn Transport>,
}
impl Transport for SearchFixtureTransport {
    fn open_browser(&self, url: &str) -> Result<(), String> {
        self.fallback.open_browser(url)
    }
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let name = match endpoint {
            Endpoint::Snapshot => Some("manifest.json".into()),
            Endpoint::SnapshotPage => Some(format!(
                "page-{}.json",
                body.as_ref()
                    .and_then(|b| b["page"].as_u64())
                    .ok_or("invalid_input")?
            )),
            _ => None,
        };
        if let Some(name) = name {
            let bytes =
                std::fs::read(self.directory.join(name)).map_err(|_| "fixture_unavailable")?;
            return serde_json::from_slice(&bytes).map_err(|_| "invalid_response".into());
        }
        self.fallback.request(origin, endpoint, token, body)
    }
}
