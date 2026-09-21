#[test]
fn compatibility_preserves_pending_variants_before_any_upload() {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!("../../../../packages/api-contract/src/compatibility-fixtures.json")).unwrap();
    for case in cases {
        let (directory, service, transport) = downloaded_change_fixture();
        let request = save_request(&service);
        service.library_create(request.clone()).unwrap();
        let before = serde_json::to_value(service.library_pending().unwrap()).unwrap();
        let mut capabilities = fixtures()["capabilities"].clone();
        capabilities["protocols"] = case["protocols"].clone();
        capabilities["normalization"] = case["normalization"].clone();
        transport.0.lock().unwrap().push(capabilities);
        if case["compatible"] == true {
            transport.0.lock().unwrap().extend([fixtures()["session"].clone(), serde_json::from_str::<serde_json::Value>(include_str!("../../../../packages/api-contract/src/upload-fixtures.json")).unwrap()["accepted"].clone()]);
        }
        let status = service.library_upload().unwrap();
        if case["compatible"] == true {
            assert!(status.error.is_none(), "{}: {:?}", case["name"], status.error);
            assert_eq!(status.awaiting_download, 1);
        } else {
            assert_eq!(status.error.as_deref(), Some("compatibility_update_required"));
            assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), before);
        }
        assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, request.desired.content);
        assert!(!service.library_browse(0).unwrap().is_empty());
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
