#[test]
fn offline_variable_copy_uses_shared_conformance_and_preserves_template() {
    let directory = std::env::temp_dir().join(format!("pr0-variables-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/variable-fixtures.json"
    ))
    .unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let mut save = save_request(&service);
        save.prompt_id = uuid::Uuid::new_v4().to_string();
        save.operation_id = uuid::Uuid::new_v4().to_string();
        save.desired.content = fixture["content"].as_str().unwrap().into();
        service.library_create(save.clone()).unwrap();
        let mut request = copy_request(&service, &save.prompt_id);
        request.template = Some(save.desired.content.clone());
        request.values = serde_json::from_value(fixture["values"].clone()).unwrap();
        service
            .launcher_copy(request, |text| {
                assert_eq!(text, fixture["output"].as_str().unwrap());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            service.library_detail(&save.prompt_id).unwrap().content,
            save.desired.content
        );
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn thousands_of_variables_and_long_names_copy_without_new_limits_and_usage_failure_never_repeats_the_write(
) {
    let directory =
        std::env::temp_dir().join(format!("pr0-many-variables-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let mut save = save_request(&service);
    let names: Vec<String> = (0..4000)
        .map(|i| format!("value_{i}"))
        .chain(std::iter::once("x".repeat(4000)))
        .collect();
    save.desired.content = names
        .iter()
        .map(|name| format!("{{{{{name}}}}}"))
        .collect::<Vec<_>>()
        .join("/");
    service.library_create(save.clone()).unwrap();
    let mut request = copy_request(&service, &save.prompt_id);
    request.template = Some(save.desired.content.clone());
    request.values = names
        .into_iter()
        .map(|name| (name, "filled".into()))
        .collect();
    super::library_storage::set_test_fault("usage_io_error");
    let result = service
        .library_copy(request.clone(), |output| {
            assert_eq!(output, vec!["filled"; 4001].join("/"));
            Ok(())
        })
        .unwrap();
    super::library_storage::set_test_fault("");
    assert!(!result.usage_saved);
    let acknowledgement = serde_json::to_value(result).unwrap();
    assert!(acknowledgement["origin"].get("values").is_none());
    assert!(acknowledgement["origin"].get("template").is_none());
    service.library_retry_usage().unwrap();
    assert_eq!(
        service.library_detail(&save.prompt_id).unwrap().content,
        save.desired.content
    );
    assert_eq!(
        service.library_detail(&save.prompt_id).unwrap().use_count,
        1
    );
    assert_eq!(service.library_usage_status().unwrap().waiting, 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn native_variable_validation_matches_shared_numbers_scalars_and_byte_bounds() {
    let directory =
        std::env::temp_dir().join(format!("pr0-variable-bounds-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/variable-validation-fixtures.json"
    ))
    .unwrap();
    let check = |content: &str, value: String, accepted: bool| {
        let mut save = save_request(&service);
        save.prompt_id = uuid::Uuid::new_v4().to_string();
        save.operation_id = uuid::Uuid::new_v4().to_string();
        save.desired.content = content.into();
        service.library_create(save.clone()).unwrap();
        let mut request = copy_request(&service, &save.prompt_id);
        request.template = Some(content.into());
        request.values = vec![("x".into(), value.clone())];
        let result = service.library_copy(request, |output| {
            assert!(accepted, "rejected value reached clipboard");
            if content == "{{x|number}}" {
                assert_eq!(output, value);
            }
            Ok(())
        });
        assert_eq!(result.is_ok(), accepted);
        assert_eq!(
            service.library_detail(&save.prompt_id).unwrap().use_count,
            u64::from(accepted)
        );
    };
    for value in fixture["acceptedNumbers"].as_array().unwrap() {
        check("{{x|number}}", value.as_str().unwrap().into(), true);
    }
    for value in fixture["rejectedNumbers"].as_array().unwrap() {
        check("{{x|number}}", value.as_str().unwrap().into(), false);
    }
    for value in fixture["invalidStrings"].as_array().unwrap() {
        check("{{x}}", value.as_str().unwrap().into(), false);
    }
    for bound in fixture["bounds"].as_array().unwrap() {
        check(
            bound["content"].as_str().unwrap(),
            bound["unit"]
                .as_str()
                .unwrap()
                .repeat(bound["repeat"].as_u64().unwrap() as usize),
            bound["ok"].as_bool().unwrap(),
        );
    }
    for units in fixture["invalidUtf16Units"].as_array().unwrap() {
        let unit = units[0].as_u64().unwrap();
        let mut request = serde_json::to_value(copy_request(
            &service,
            "66666666-6666-4666-8666-666666666666",
        ))
        .unwrap();
        request["values"] = json!([["x", "SENTINEL"]]);
        let wire = request
            .to_string()
            .replace("SENTINEL", &format!("\\u{unit:04x}"));
        assert!(serde_json::from_str::<super::usage_contract::CopyRequest>(&wire).is_err());
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn started_copy_can_finish_after_transition_without_usage_in_the_new_partition() {
    let directory =
        std::env::temp_dir().join(format!("pr0-variable-transition-{}", uuid::Uuid::new_v4()));
    let service = Arc::new(downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    ));
    let request = copy_request(&service, "66666666-6666-4666-8666-666666666666");
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let worker = service.clone();
    let start = entered.clone();
    let end = release.clone();
    let task = std::thread::spawn(move || {
        worker.library_copy(request, |_| {
            start.wait();
            end.wait();
            Ok(())
        })
    });
    entered.wait();
    let transition = service.transition(transition_request(&service, "discard", true));
    release.wait();
    assert!(transition.is_ok());
    assert!(!task.join().unwrap().unwrap().usage_saved);
    assert_eq!(view(&service)["state"], "signed_out");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn copy_template_is_partition_bound_and_never_writes_an_updated_template_implicitly() {
    let directory = std::env::temp_dir().join(format!("pr0-template-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let mut save = save_request(&service);
    save.desired.content = "{{x}}".into();
    service.library_create(save.clone()).unwrap();
    let mut request = copy_request(&service, &save.prompt_id);
    assert_eq!(
        service.copy_template(&request, true).unwrap().content,
        "{{x}}"
    );
    request.template = Some("old {{x}}".into());
    request.values = vec![("x".into(), "private".into())];
    assert_eq!(
        service
            .launcher_copy(request.clone(), |_| panic!("changed template write"))
            .err()
            .as_deref(),
        Some("template_changed")
    );
    request.template = None;
    assert_eq!(
        service
            .launcher_copy(request.clone(), |_| panic!("unfrozen template write"))
            .err()
            .as_deref(),
        Some("template_changed")
    );
    request.generation += 1;
    assert_eq!(
        service.copy_template(&request, true).err().as_deref(),
        Some("operation_cancelled")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
