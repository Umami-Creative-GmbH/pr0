fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "auth_status",
            "auth_begin",
            "auth_poll",
            "auth_cancel",
            "auth_open_browser",
            "auth_refresh",
            "auth_sign_out",
            "library_status",
            "library_download",
            "library_browse",
            "library_detail",
        ]),
    ))
    .expect("could not build native permissions");
}
