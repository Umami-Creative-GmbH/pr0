// Public typed commands over the real persisted library, using the approved native seam.
#[test]
fn search_reopen_rejects_incompatible_normalization_until_recovery() {
    let directory =
        std::env::temp_dir().join(format!("pr0-search-version-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    let request = search_request(&service, "Hello");
    drop(service);
    let db = rusqlite::Connection::open(
        super::library_storage::library_path(&directory, &request.instance_id, &request.account_id)
            .unwrap(),
    )
    .unwrap();
    db.execute(
        "UPDATE local_search_version SET normalization='incompatible'",
        [],
    )
    .unwrap();
    drop(db);
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        service
            .library_search(search_request(&service, "Hello"))
            .err()
            .as_deref(),
        Some("search_recovery_required")
    );
    service
        .library_recover_search(search_request(&service, ""))
        .unwrap();
    assert_eq!(
        service
            .library_search(search_request(&service, "Hello"))
            .unwrap()
            .prompts
            .len(),
        2
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn search_shared_sort_recency_scope_and_filter_fixtures() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/search-order-fixtures.json"
    ))
    .unwrap();
    let org:Vec<_>=(0..2).map(|index|json!({"id":format!("aaaaaaaa-aaaa-4aaa-8aaa-{index:012}"),"name":format!("Organization {index}"),"revision":"1","activeCount":0,"archivedCount":0,"totalCount":0})).collect();
    let prompts = data["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, fixture)| {
            let mut prompt = search_prompt(index);
            for field in [
                "id",
                "title",
                "createdAt",
                "modifiedAt",
                "lastUsedAt",
                "favorite",
                "archived",
            ] {
                prompt[field] = fixture[field].clone();
            }
            prompt["content"] = json!("needle");
            prompt["tagIds"] = json!(fixture["tags"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| org[v.as_u64().unwrap() as usize]["id"].clone())
                .collect::<Vec<_>>());
            prompt["collectionId"] =
                org[fixture["collection"].as_u64().unwrap() as usize]["id"].clone();
            prompt
        })
        .collect();
    let directory = std::env::temp_dir().join(format!("pr0-search-order-{}", uuid::Uuid::new_v4()));
    let service = search_download(
        &directory,
        search_snapshot(prompts, org.clone(), org.clone()),
    );
    for case in data["cases"].as_array().unwrap() {
        let mut request = search_request(&service, "needle");
        request.limit = 2;
        request.sort = case["sort"].as_str().unwrap().into();
        request.view = case["view"].as_str().unwrap().into();
        request.favorite = case["favorite"].as_bool();
        request.collection_id = case["collection"]
            .as_u64()
            .map(|i| org[i as usize]["id"].as_str().unwrap().into());
        request.view_collection_id = case["viewCollection"]
            .as_u64()
            .map(|i| org[i as usize]["id"].as_str().unwrap().into());
        request.tag_ids = case["tags"].as_array().map_or(vec![], |tags| {
            tags.iter()
                .map(|v| {
                    org[v.as_u64().unwrap() as usize]["id"]
                        .as_str()
                        .unwrap()
                        .into()
                })
                .collect()
        });
        let mut ids = Vec::new();
        loop {
            let page = service.library_search(request.clone()).unwrap();
            ids.extend(page.prompts.into_iter().map(|p| p.id));
            request.cursor = page.next_cursor;
            if request.cursor.is_none() {
                break;
            }
        }
        let expected: Vec<_> = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                data["prompts"][v.as_u64().unwrap() as usize]["id"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(ids, expected, "{case}");
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn search_snapshot(
    prompts: Vec<serde_json::Value>,
    tags: Vec<serde_json::Value>,
    collections: Vec<serde_json::Value>,
) -> serde_json::Value {
    use sha2::{Digest, Sha256};
    let mut data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let mut records: serde_json::Value =
        serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
    data["manifest"]["promptCount"] = json!(prompts.len());
    records["organization"]["tags"] = json!(tags);
    records["organization"]["collections"] = json!(collections);
    let mut pages = Vec::new();
    let mut digests = Vec::new();
    for (index, chunk) in prompts.chunks(500).enumerate() {
        if index > 0 {
            records["organization"] = serde_json::Value::Null;
        }
        records["prompts"] = json!(chunk);
        let payload = records.to_string();
        digests.push(json!({"bytes":payload.len(),"digest":format!("{:x}",Sha256::digest(payload.as_bytes()))}));
        pages.push(json!({"id":data["manifest"]["id"],"page":index,"payload":payload}));
    }
    data["manifest"]["pages"] = json!(digests);
    data["pages"] = json!(pages);
    data
}
fn search_prompt(index: usize) -> serde_json::Value {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let records: serde_json::Value =
        serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
    let mut prompt = records["prompts"][0].clone();
    prompt["id"] = json!(format!("00000000-0000-4000-8000-{index:012}"));
    prompt
}
fn search_download(directory: &std::path::Path, data: serde_json::Value) -> AuthService {
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().push(data["manifest"].clone());
    transport
        .0
        .lock()
        .unwrap()
        .extend(data["pages"].as_array().unwrap().iter().cloned());
    let service =
        AuthService::new(directory.into(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    for _ in data["pages"].as_array().unwrap() {
        service.library_download().unwrap();
    }
    service
}

#[test]
fn search_snapshot_reclaims_slots_before_replacing_a_full_library() {
    use sha2::{Digest, Sha256};
    let prompts: Vec<_> = (0..10000)
        .map(|index| {
            let mut p = search_prompt(index);
            p["content"] = json!("body");
            p
        })
        .collect();
    let mut replacement_prompts = prompts.clone();
    replacement_prompts[9999]["id"] = json!("ffffffff-ffff-4fff-8fff-ffffffffffff");
    replacement_prompts[9999]["title"] = json!("Replacement");
    let first = search_snapshot(prompts, vec![], vec![]);
    let mut replacement = search_snapshot(replacement_prompts, vec![], vec![]);
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    replacement["manifest"]["id"] = json!(snapshot_id);
    replacement["manifest"]["revision"] = json!("3");
    for page in replacement["pages"].as_array_mut().unwrap() {
        page["id"] = json!(snapshot_id);
    }
    let mut records: serde_json::Value =
        serde_json::from_str(replacement["pages"][0]["payload"].as_str().unwrap()).unwrap();
    records["organization"]["revision"] = json!("3");
    let payload = records.to_string();
    replacement["pages"][0]["payload"] = json!(payload);
    replacement["manifest"]["pages"][0] =
        json!({"bytes":payload.len(),"digest":format!("{:x}",Sha256::digest(payload.as_bytes()))});
    let transport = approval();
    transport.0.lock().unwrap().pop();
    for snapshot in [&first, &replacement] {
        transport
            .0
            .lock()
            .unwrap()
            .push(snapshot["manifest"].clone());
        transport
            .0
            .lock()
            .unwrap()
            .extend(snapshot["pages"].as_array().unwrap().iter().cloned());
    }
    let directory = std::env::temp_dir().join(format!("pr0-search-slots-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    for snapshot in [&first, &replacement] {
        for _ in snapshot["pages"].as_array().unwrap() {
            service.library_download().unwrap();
        }
    }
    let page = service
        .library_search(search_request(&service, "Replacement"))
        .unwrap();
    assert_eq!(page.prompts[0].id, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(service.library_status().unwrap().downloaded, 10000);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn search_shared_six_tiers_include_organization_and_complete_later_pages() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/search-fixtures.json"
    ))
    .unwrap();
    let org = json!({"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"German","revision":"1","activeCount":1,"archivedCount":0,"totalCount":1});
    let prompts = data["relevanceFixtures"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, f)| {
            let mut p = search_prompt(index);
            for field in ["title", "description", "content"] {
                p[field] = f[field].clone();
            }
            if f["tag"] != "" {
                p["tagIds"] = json!([org["id"]]);
            }
            if f["collection"] != "" {
                p["collectionId"] = org["id"].clone();
            }
            p
        })
        .collect();
    let directory = std::env::temp_dir().join(format!("pr0-search-tiers-{}", uuid::Uuid::new_v4()));
    let service = search_download(
        &directory,
        search_snapshot(prompts, vec![org.clone()], vec![org]),
    );
    let mut request = search_request(&service, "German email");
    request.limit = 2;
    let mut titles = Vec::new();
    loop {
        let page = service.library_search(request.clone()).unwrap();
        titles.extend(page.prompts.into_iter().map(|p| p.title));
        request.cursor = page.next_cursor;
        if request.cursor.is_none() {
            break;
        }
    }
    assert_eq!(
        titles,
        vec![
            "German email",
            "Email templates in German",
            "Email reply",
            "Reply template",
            "Response template",
            "Translation helper"
        ]
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn search_request(service: &AuthService, query: &str) -> super::search_contract::SearchRequest {
    let state = view(service);
    serde_json::from_value(json!({
        "instanceId": state["instanceId"], "accountId": state["accountId"],
        "generation": state["generation"], "requestId": uuid::Uuid::new_v4().to_string(), "query": query, "view": "all",
        "sort": "relevance", "tagIds": [], "limit": 50
    })).unwrap()
}
#[test]
fn search_cancelled_admission_cannot_run_after_newer_typeahead() {
    let directory =
        std::env::temp_dir().join(format!("pr0-search-cancel-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    );
    let old = search_request(&service, "Hello");
    let token = service.admit_search(&old.request_id).unwrap();
    let next = search_request(&service, "First");
    service.admit_search(&next.request_id).unwrap();
    assert_eq!(
        service.library_search_admitted(old, token).err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(service.library_search(next).unwrap().prompts.len(), 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn search_corruption_reports_recovery_preserves_primary_and_rebuilds_explicitly() {
    let directory =
        std::env::temp_dir().join(format!("pr0-search-recovery-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    let saved = service.library_create(save_request(&service)).unwrap();
    let request = search_request(&service, "First");
    drop(service);
    let path =
        super::library_storage::library_path(&directory, &request.instance_id, &request.account_id)
            .unwrap();
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute_batch("DROP TABLE local_f_content").unwrap();
    drop(db);
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        service
            .library_search(search_request(&service, "Hello"))
            .err()
            .as_deref(),
        Some("search_recovery_required")
    );
    assert_eq!(
        service.library_detail(&saved.prompt.id).unwrap().content,
        saved.prompt.content
    );
    service
        .library_recover_search(search_request(&service, ""))
        .unwrap();
    assert_eq!(
        service
            .library_search(search_request(&service, "Hello"))
            .unwrap()
            .prompts
            .len(),
        2
    );
    assert_eq!(service.library_pending().unwrap().len(), 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn search_shared_unicode_vectors_match_in_each_of_the_five_fields() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/search-fixtures.json"
    ))
    .unwrap();
    let vectors = data["textSearchFixtures"].as_array().unwrap();
    let mut prompts = Vec::new();
    let mut tags = Vec::new();
    let mut collections = Vec::new();
    for (index, fixture) in vectors.iter().enumerate() {
        for (field_index, field) in ["title", "description", "content", "tag", "collection"]
            .iter()
            .enumerate()
        {
            let mut p = search_prompt(index * 5 + field_index);
            p["title"] = json!("Fixture");
            p["content"] = json!("body");
            if field_index < 3 {
                p[*field] = fixture["text"].clone();
            } else {
                let org = json!({"id":p["id"],"name":fixture["text"],"revision":"1","activeCount":1,"archivedCount":0,"totalCount":1});
                if *field == "tag" {
                    p["tagIds"] = json!([p["id"]]);
                    tags.push(org);
                } else {
                    p["collectionId"] = p["id"].clone();
                    collections.push(org);
                }
            }
            prompts.push(p);
        }
    }
    let directory =
        std::env::temp_dir().join(format!("pr0-search-unicode-{}", uuid::Uuid::new_v4()));
    let service = search_download(
        &directory,
        search_snapshot(prompts.clone(), tags, collections),
    );
    for (index, fixture) in vectors.iter().enumerate() {
        let mut request = search_request(&service, fixture["query"].as_str().unwrap());
        request.limit = 100;
        let page = service.library_search(request).unwrap();
        for field in 0..5 {
            assert_eq!(
                page.prompts
                    .iter()
                    .any(|p| p.id == prompts[index * 5 + field]["id"]),
                fixture["matches"].as_bool().unwrap(),
                "vector {index}, field {field}"
            );
        }
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn search_pages_bind_local_revision_and_filters_and_selection_follows_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-search-pages-{}", uuid::Uuid::new_v4()));
    let mut prompts = Vec::new();
    for index in 0..105 {
        let mut p = search_prompt(index);
        p["title"] = json!(format!("Prompt {index:03}"));
        p["favorite"] = json!(index % 2 == 0);
        p["archived"] = json!(index == 104);
        prompts.push(p);
    }
    let service = search_download(&directory, search_snapshot(prompts, vec![], vec![]));
    let mut request = search_request(&service, "");
    request.sort = "title".into();
    request.selected_id = Some(search_prompt(103)["id"].as_str().unwrap().into());
    let first = service.library_search(request.clone()).unwrap();
    assert_eq!(first.prompts.len(), 50);
    assert_eq!(first.selected_id, request.selected_id);
    request.cursor = first.next_cursor;
    let second = service.library_search(request.clone()).unwrap();
    assert_eq!(second.prompts[0].title, "Prompt 050");
    let mut changed = request.clone();
    changed.favorite = Some(true);
    assert_eq!(
        service.library_search(changed).err().as_deref(),
        Some("invalid_cursor")
    );
    request.cursor = second.next_cursor;
    let last = service.library_search(request.clone()).unwrap();
    assert_eq!(last.prompts.len(), 4);
    assert!(last.next_cursor.is_none());
    service.library_create(save_request(&service)).unwrap();
    assert_eq!(
        service.library_search(request).err().as_deref(),
        Some("results_changed")
    );
    let mut favorites = search_request(&service, "");
    favorites.view = "favorites".into();
    favorites.limit = 100;
    assert_eq!(service.library_search(favorites).unwrap().prompts.len(), 52);
    let mut archive = search_request(&service, "");
    archive.view = "archive".into();
    assert_eq!(
        service.library_search(archive).unwrap().prompts[0].title,
        "Prompt 104"
    );
    let mut missing = search_request(&service, "");
    missing.tag_ids = vec![uuid::Uuid::new_v4().to_string()];
    assert!(service.library_search(missing).unwrap().prompts.is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn search_finds_downloaded_and_saved_text_and_reopens_without_losing_pending_work() {
    let directory = std::env::temp_dir().join(format!("pr0-search-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    let downloaded = service
        .library_search(search_request(&service, "First"))
        .unwrap();
    assert_eq!(downloaded.prompts.len(), 1);
    let mut save = save_request(&service);
    save.desired.title = "Café Straße".into();
    save.desired.content = "literal C++ and 🫠".into();
    let saved = service.library_create(save).unwrap();
    let results = service
        .library_search(search_request(&service, "CAFE strasse C++ 🫠"))
        .unwrap();
    assert_eq!(
        results
            .prompts
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>(),
        vec![saved.prompt.id.as_str()]
    );
    assert!(service
        .library_search(search_request(&service, "ueber"))
        .unwrap()
        .prompts
        .is_empty());
    drop(service);
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        service
            .library_search(search_request(&service, "strasse"))
            .unwrap()
            .prompts[0]
            .id,
        saved.prompt.id
    );
    assert_eq!(service.library_pending().unwrap().len(), 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
