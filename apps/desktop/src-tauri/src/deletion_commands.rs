// Included in auth so deletion acceptance and account generation change share one lock.
impl AuthService {
    fn check_deletion(&self) -> Result<bool, String> {
        let (generation, retained) = {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
            let Some(retained) = &state.retained else {
                return Ok(false);
            };
            if state.clearing || retained.cleanup_pending {
                return Err("cleanup_required".into());
            }
            (state.generation, retained.clone())
        };
        let lookup: super::deletion_status::Lookup = decode(self.transport.request(
            &retained.trust.origin,
            Endpoint::DeletionLookup,
            None,
            Some(json!({"handle": retained.identity.deletion_handle})),
        )?)?;
        let Some(confirmed) = super::deletion_status::confirmed(lookup, &retained)? else {
            return Ok(false);
        };
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        // Invalidate all in-flight commands before filesystem/credential cleanup.
        state.generation += 1;
        state.clearing = true;
        state.signing_out = false;
        state.attempt = None;
        state.credential = None;
        let mut retained = retained;
        retained.cleanup_pending = true;
        retained.deletion = Some(confirmed);
        state.retained = Some(retained);
        state.message =
            "Account deletion confirmed. Local cleanup must finish; retry cleanup if needed."
                .into();
        self.wake_sync();
        self.finish_deleted_cleanup(&mut state)?;
        Ok(true)
    }
    fn finish_deleted_cleanup(&self, state: &mut State) -> Result<(), String> {
        let retained = state.retained.as_ref().ok_or("cleanup_required")?;
        if !retained.deletion_confirmed() {
            return Err("invalid_deletion_evidence".into());
        }
        // Persist the confirmed deletion and cleanup intent before destroying anything.
        // Retry is safe after restart.
        state.storage.save(retained)?;
        self.credentials.delete()?;
        state.library = None;
        for path in self.library_cleanup_paths(state)? {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("storage_unavailable".into()),
            }
        }
        state.storage.clear()?;
        state.retained = None;
        state.memory_usage.clear();
        state.clearing = false;
        state.message = "Account deletion confirmed. This account's local library, pending work and sign-in have been removed.".into();
        Ok(())
    }
}
