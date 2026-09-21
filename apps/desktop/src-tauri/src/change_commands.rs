// One coordinator owns the network poll. No state lock or SQLite transaction spans HTTP.
impl AuthService {
    pub fn wake_sync(&self) {
        if let Ok(mut generation) = self.wake.0.lock() {
            *generation += 1;
            self.wake.1.notify_all();
        }
    }
    pub fn sync_generation(&self) -> u64 {
        self.wake.0.lock().map(|v| *v).unwrap_or(0)
    }
    pub fn wait_for_sync(&self, observed: u64, duration: Duration) {
        if let Ok(generation) = self.wake.0.lock() {
            let _ = self
                .wake
                .1
                .wait_timeout_while(generation, duration, |current| *current == observed);
        }
    }
    pub fn library_change_status(&self) -> Result<super::change_contract::ChangeStatus, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.change_status()
    }
    pub fn library_changes(
        &self,
        wait: u32,
    ) -> Result<super::change_contract::ChangeStatus, String> {
        let _poll = self.changes.try_lock().map_err(|_| "changes_in_progress")?;
        let (generation, envelope, request) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let envelope = state.credential.clone().ok_or("authentication_required")?;
            let generation = state.generation;
            let store = self.library(&mut state)?;
            let Some(request) = store.change_request(wait)? else {
                return store.change_status();
            };
            (generation, envelope, request)
        };
        let response = self.snapshot_request(generation, &envelope, Endpoint::Changes, request);
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        let result = response
            .and_then(decode)
            .and_then(|page| self.library(&mut state)?.apply_changes(page));
        if let Err(error) = result {
            self.library(&mut state)?.change_failed(&error)?;
        }
        self.library(&mut state)?.change_status()
    }
}
