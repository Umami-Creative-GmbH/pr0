// Included in auth's module so the active identity/connection share its generation lock.
impl AuthService {
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
        let paths: Vec<_> = ["", "-wal", "-shm"]
            .iter()
            .map(|suffix| self.directory.join(format!("{name}{suffix}")))
            .collect();
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
    fn review_library_cleanup(&self, state: &mut State) -> Result<(), String> {
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
        // Version 1 contains downloaded data only. Unknown newer schemas may own pending edits.
        if paths.first().is_some_and(|path| path.exists()) {
            let retained = state.retained.as_ref().ok_or("authentication_required")?;
            if state.library.is_none() {
                state.library = Some(LibraryStore::open(
                    &self.directory,
                    &retained.identity.instance.id,
                    &retained.identity.account.id,
                )?);
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
        let result = self.transport.request(
            &envelope.origin,
            endpoint,
            Some(&envelope.token),
            Some(body),
        );
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        if let Err(error) = &result {
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
        let (generation, envelope, pending) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let envelope = state.credential.clone().ok_or("authentication_required")?;
            let generation = state.generation;
            let store = self.library(&mut state)?;
            let status = store.status()?;
            if status.complete {
                return Ok(status);
            }
            (generation, envelope, store.pending()?)
        };
        let (manifest, index) = match pending {
            Some((manifest, index)) if !manifest.expired() => (manifest, index),
            _ => {
                let manifest: Manifest = decode(self.snapshot_request(
                    generation,
                    &envelope,
                    Endpoint::Snapshot,
                    json!({}),
                )?)?;
                manifest.validate(&envelope.instance_id, &envelope.account_id)?;
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != generation {
                    return Err("operation_cancelled".into());
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
        if let Err(error) = store.apply(&manifest, index, page) {
            state.library = None;
            return Err(error);
        }
        store.status()
    }
}
