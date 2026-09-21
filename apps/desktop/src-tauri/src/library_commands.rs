// Included in auth's module so the active identity/connection share its generation lock.
impl AuthService {
    pub fn admit_search(&self, id: &str) -> Result<Arc<std::sync::atomic::AtomicBool>, String> {
        if !valid_id(id) {return Err("invalid_input".into());}
        let cancelled=Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut active=self.search.lock().map_err(|_|"state_unavailable")?;
        if let Some((_,old))=active.replace((id.into(),cancelled.clone())) {old.store(true,std::sync::atomic::Ordering::Relaxed);}
        Ok(cancelled)
    }
    pub fn cancel_search(&self, id: &str) -> Result<(),String> {
        let active=self.search.lock().map_err(|_|"state_unavailable")?;
        if let Some((current,cancelled))=active.as_ref() {if current==id {cancelled.store(true,std::sync::atomic::Ordering::Relaxed);}}
        Ok(())
    }
    pub fn library_recover_search(&self, request: super::search_contract::SearchRequest) -> Result<(), String> {
        request.validate()?;
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if request.generation != state.generation || request.instance_id != retained.identity.instance.id || request.account_id != retained.identity.account.id { return Err("operation_cancelled".into()); }
        self.library(&mut state)?.recover_search()
    }
    pub fn library_search(&self, request: super::search_contract::SearchRequest) -> Result<super::search_contract::SearchPage, String> {
        let cancelled=self.admit_search(&request.request_id)?;
        self.library_search_admitted(request,cancelled)
    }
    pub fn library_search_admitted(&self, request: super::search_contract::SearchRequest, cancelled: Arc<std::sync::atomic::AtomicBool>) -> Result<super::search_contract::SearchPage,String> {
        request.validate()?;
        let check=|| cancelled.load(std::sync::atomic::Ordering::Relaxed);
        if check() {return Err("operation_cancelled".into());}
        let _gate=self.search_gate.try_lock().map_err(|_|"search_busy")?;
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if request.generation != state.generation || request.instance_id != retained.identity.instance.id || request.account_id != retained.identity.account.id {
            return Err("operation_cancelled".into());
        }
        self.library(&mut state)?.search(&request,&check)
    }
    pub fn copy_draft(
        &self,
        instance: &str,
        account: &str,
        generation: u64,
        text: &str,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        let _clipboard = self.clipboard.try_lock().map_err(|_| "clipboard_busy")?;
        // No queued overlapping writes, and account transitions cannot race this short OS call.
        let state = self.state.try_lock().map_err(|_| "clipboard_busy")?;
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if state.clearing
            || state.signing_out
            || retained.cleanup_pending
            || generation != state.generation
            || retained.identity.instance.id != instance
            || retained.identity.account.id != account
        {
            return Err("operation_cancelled".into());
        }
        if text.len() > 4_194_304 || text.contains('\0') {
            return Err("copy_text_too_large".into());
        }
        write(text)
    }
    fn library_cleanup_paths(&self, state: &State) -> Result<Vec<PathBuf>, String> {
        let Some(retained) = &state.retained else {
            return Ok(vec![]);
        };
        let path = super::library_storage::library_path(
            &self.directory,
            &retained.identity.instance.id,
            &retained.identity.account.id,
        )?;
        let name = path
            .file_name()
            .ok_or("storage_unavailable")?
            .to_string_lossy();
        let mut paths: Vec<_> = ["", "-wal", "-shm"]
            .iter()
            .map(|suffix| self.directory.join(format!("{name}{suffix}")))
            .collect();
        paths.extend(super::migration_backup::paths(&path));
        for path in &paths {
            if path.parent() != Some(self.directory.as_path())
                || std::fs::symlink_metadata(path)
                    .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
            {
                return Err("local_data_requires_review".into());
            }
        }
        Ok(paths)
    }
    fn review_library_cleanup(&self, state: &mut State, discard: bool) -> Result<(), String> {
        if !discard
            && !state.memory_usage.is_empty()
            && !state.retained.as_ref().is_some_and(|r| r.cleanup_pending)
        {
            return Err("pending_work".into());
        }
        let paths = self.library_cleanup_paths(state)?;
        for entry in std::fs::read_dir(&self.directory).map_err(|_| "storage_unavailable")? {
            let entry = entry.map_err(|_| "storage_unavailable")?;
            let name = entry.file_name();
            if ![
                "session-state.sqlite",
                "session-state.sqlite-journal",
                "session-state.sqlite-wal",
                "session-state.sqlite-shm",
            ]
            .contains(&name.to_string_lossy().as_ref())
                && !paths.contains(&entry.path())
            {
                return Err("local_data_requires_review".into());
            }
        }
        // Accepted receipts already prove server durability, even before a fresh download.
        if !discard
            && !state.retained.as_ref().is_some_and(|r| r.cleanup_pending)
            && paths.first().is_some_and(|path| path.exists())
        {
            let retained = state.retained.as_ref().ok_or("authentication_required")?;
            if state.library.is_none() {
                state.library = Some(LibraryStore::open(
                    &self.directory,
                    &retained.identity.instance.id,
                    &retained.identity.account.id,
                )?);
            }
            let store = state.library.as_ref().ok_or("storage_unavailable")?;
            if store.upload_status()?.waiting > 0 || store.usage_status()?.waiting > 0 || store.status()?.recovery_count > 0 {
                return Err("pending_work".into());
            }
        }
        Ok(())
    }
    fn library<'a>(&self, state: &'a mut State) -> Result<&'a mut LibraryStore, String> {
        if state.clearing {
            return Err("operation_cancelled".into());
        }
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if retained.cleanup_pending {
            return Err("operation_cancelled".into());
        }
        if state.library.is_none() {
            state.library = Some(LibraryStore::open(
                &self.directory,
                &retained.identity.instance.id,
                &retained.identity.account.id,
            )?);
        }
        state
            .library
            .as_mut()
            .ok_or_else(|| "storage_unavailable".into())
    }
    pub fn library_status(&self) -> Result<LibraryStatus, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.status()
    }
    pub fn library_recovery_browse(&self, offset: u32) -> Result<Vec<super::library_contract::RecoverySummary>, String> {
        let mut state = self.state.lock().map_err(|_|"state_unavailable")?;
        self.library(&mut state)?.recovery_browse(offset)
    }
    pub fn library_recovery_detail(&self, snapshot: &str, id: &str) -> Result<Prompt, String> {
        let mut state = self.state.lock().map_err(|_|"state_unavailable")?;
        self.library(&mut state)?.recovery_detail(snapshot,id)
    }
    pub fn library_pause_download(&self, paused: bool) -> Result<LibraryStatus, String> {
        let mut state = self.state.lock().map_err(|_|"state_unavailable")?;
        self.library(&mut state)?.pause_download(paused)?;
        self.wake_sync();
        self.library(&mut state)?.status()
    }
    pub fn library_create(
        &self,
        request: super::local_contract::SaveRequest,
    ) -> Result<super::local_contract::LocalPrompt, String> {
        self.save_prompt(request, true)
    }
    pub fn library_edit(
        &self,
        request: super::local_contract::SaveRequest,
    ) -> Result<super::local_contract::LocalPrompt, String> {
        self.save_prompt(request, false)
    }
    pub fn library_editor(&self, id: &str) -> Result<super::local_contract::LocalPrompt, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.local_detail(id)
    }
    #[cfg(test)]
    pub fn library_pending(&self) -> Result<Vec<super::local_contract::PendingChange>, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.pending_changes()
    }
    fn save_prompt(
        &self,
        request: super::local_contract::SaveRequest,
        create: bool,
    ) -> Result<super::local_contract::LocalPrompt, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.signing_out {
            return Err("transition_in_progress".into());
        }
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if state.generation != request.generation
            || retained.identity.instance.id != request.instance_id
            || retained.identity.account.id != request.account_id
        {
            return Err("operation_cancelled".into());
        }
        let result = self.library(&mut state)?.save(request, create);
        if result.is_err() {
            state.library = None;
        }
        result
    }
    pub fn library_browse(&self, offset: u32) -> Result<Vec<Summary>, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.browse(offset)
    }
    pub fn library_detail(&self, id: &str) -> Result<Prompt, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.detail(id)
    }
    /// One bounded page per command. Network waits never hold the storage lock.
    fn snapshot_request(
        &self,
        generation: u64,
        envelope: &Envelope,
        endpoint: Endpoint,
        body: Value,
    ) -> Result<Value, String> {
        {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation != generation
                || state.clearing
                || state.retained.as_ref().is_some_and(|r| r.cleanup_pending)
            {
                return Err("operation_cancelled".into());
            }
        }
        let observed = self.sync_generation();
        let result = if matches!(endpoint, Endpoint::Changes) {
            self.transport
                .changes(&envelope.origin, &envelope.token, body, &|| {
                    self.sync_generation() != observed
                        || self
                            .state
                            .lock()
                            .map_or(true, |state| state.generation != generation)
                })
        } else {
            self.transport.request(
                &envelope.origin,
                endpoint,
                Some(&envelope.token),
                if matches!(endpoint, Endpoint::Capabilities) {
                    None
                } else {
                    Some(body)
                },
            )
        };
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        if let Err(error) = &result {
            if matches!(endpoint, Endpoint::Snapshot | Endpoint::SnapshotPage)
                && (matches!(error.as_str(), "network_unavailable" | "request_failed")
                    || error.starts_with("retry_after:"))
            {
                let seconds = error
                    .strip_prefix("retry_after:")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(30)
                    .clamp(1, 86400);
                state.next_download = Instant::now()
                    + Duration::from_millis(
                        seconds * 1000 + (uuid::Uuid::new_v4().as_u128() % 1000) as u64,
                    );
            }
            if error == "authentication_required" {
                state.credential = None;
                if let Some(retained) = &mut state.retained {
                    retained.authentication_required = true;
                }
                if let Some(retained) = &state.retained {
                    state.storage.save(retained)?;
                }
            }
            if error == "snapshot_expired" {
                self.library(&mut state)?.expire()?;
            }
        }
        result
    }
    pub fn library_download(&self) -> Result<LibraryStatus, String> {
        let _download = self
            .download
            .try_lock()
            .map_err(|_| "download_in_progress")?;
        let generation = self.state.lock().map_err(|_| "state_unavailable")?.generation;
        let result = self.download_page();
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation { return Err("operation_cancelled".into()); }
        if let Ok(store) = self.library(&mut state) {
            if result.as_ref().err().is_some_and(|e|e=="snapshot_expired") { store.expire()?; }
            store.download_result(result.as_ref().err().map(String::as_str))?;
        }
        result
    }
    fn download_page(&self) -> Result<LibraryStatus, String> {
        let (generation, envelope, pending, minimum_revision, recovering) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let envelope = state.credential.clone().ok_or("authentication_required")?;
            let generation = state.generation;
            let store = self.library(&mut state)?;
            let status = store.status()?;
            if status.paused { return Ok(status); }
            if status.complete && !store.refresh_required()? {
                return Ok(status);
            }
            if state.next_download > Instant::now() {
                return Err("download_backoff".into());
            }
            let store = self.library(&mut state)?;
            (
                generation,
                envelope,
                store.pending()?,
                store.required_download_revision()?,
                store.recovering()?,
            )
        };
        let (manifest, index) = match pending {
            Some((manifest, index)) if index == manifest.pages.len() => {
                let changes = self.library_changes(0)?;
                if let Some(error) = changes.error { return Err(error); }
                return self.library_status();
            }
            Some((manifest, index)) if !manifest.expired() => (manifest, index),
            _ => {
                let manifest: Manifest = decode(self.snapshot_request(
                    generation,
                    &envelope,
                    Endpoint::Snapshot,
                    if recovering { json!({"minimumRevision":"0"}) } else { json!({"minimumRevision":minimum_revision}) },
                )?)?;
                manifest.validate(&envelope.instance_id, &envelope.account_id)?;
                if !recovering && manifest
                    .revision
                    .parse::<i64>()
                    .map_err(|_| "invalid_response")?
                    < minimum_revision
                        .parse::<i64>()
                        .map_err(|_| "storage_unavailable")?
                {
                    return Err("invalid_response".into());
                }
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != generation {
                    return Err("operation_cancelled".into());
                }
                if self
                    .library(&mut state)?
                    .confirm_unchanged_snapshot(&manifest)?
                {
                    return self.library(&mut state)?.status();
                }
                self.library(&mut state)?.begin(&manifest)?;
                (manifest, 0)
            }
        };
        let response = self.snapshot_request(
            generation,
            &envelope,
            Endpoint::SnapshotPage,
            json!({"id":manifest.id,"page":index}),
        )?;
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        let page: Page = decode(response)?;
        let store = self.library(&mut state)?;
        if store.status()?.paused { return Err("operation_cancelled".into()); }
        if let Err(error) = store.apply(&manifest, index, page) {
            state.library = None;
            return Err(error);
        }
        store.status()
    }
}
