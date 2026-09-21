use super::usage_contract::{CopyRequest, CopyResult, Usage, UsageStatus};
impl AuthService {
    pub fn library_sync_usage(&self) -> Result<UsageStatus, String> {
        let _worker = self.upload.try_lock().map_err(|_| "upload_in_progress")?;
        self.library_retry_usage()?;
        let (generation, envelope, trust) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let status = self.library(&mut state)?.usage_status()?;
            if status.waiting == 0 || status.retry_after_ms > 0 || self.library(&mut state)?.recovering()? {
                return Ok(status);
            }
            (
                state.generation,
                state.credential.clone(),
                state
                    .retained
                    .as_ref()
                    .ok_or("authentication_required")?
                    .trust
                    .clone(),
            )
        };
        let result: Result<(), String> = (|| {
            if self.check_deletion()? {
                return Err("operation_cancelled".into());
            }
            let envelope = envelope.ok_or("authentication_required")?;
            let capabilities: Capabilities = decode(self.snapshot_request(
                generation,
                &envelope,
                Endpoint::Capabilities,
                json!(null),
            )?)?;
            capabilities.validate(&envelope.origin)?;
            capabilities.negotiate()?;
            if capabilities.instance_id != envelope.instance_id
                || capabilities.deletion_key != trust.deletion_key
            {
                return Err("incompatible_instance".into());
            }
            self.refresh_session()?;
            let prepared = {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if generation != state.generation {
                    return Err("operation_cancelled".into());
                }
                self.library(&mut state)?.prepare_usage()?
            };
            if let Some((body, replay)) = prepared {
                let endpoint = if replay {
                    Endpoint::Receipts
                } else {
                    Endpoint::Mutations
                };
                let mut response: super::upload_contract::Response = decode(
                    self.snapshot_request(generation, &envelope, endpoint, body.clone())?,
                )?;
                if response.results.len() != 1 {
                    return Err("invalid_response".into());
                }
                if let super::upload_contract::Outcome::Unknown { operation_id } =
                    &response.results[0]
                {
                    if !replay
                        || body["operations"][0]["operationId"].as_str() != Some(operation_id)
                    {
                        return Err("invalid_response".into());
                    }
                    response = decode(self.snapshot_request(
                        generation,
                        &envelope,
                        Endpoint::Mutations,
                        body.clone(),
                    )?)?;
                }
                if response.results.len() != 1 {
                    return Err("invalid_response".into());
                }
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if generation != state.generation {
                    return Err("operation_cancelled".into());
                }
                self.library(&mut state)?
                    .acknowledge_usage(&body, response.results.remove(0))?;
            }
            Ok(())
        })();
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if generation != state.generation {
            return Err("operation_cancelled".into());
        }
        let store = self.library(&mut state)?;
        if result.as_ref().err().is_some_and(|e|e=="snapshot_required") { store.change_failed("snapshot_required")?; }
        store.usage_attempt(result.err().as_deref())?;
        store.usage_status()
    }
    pub fn library_retry_usage(&self) -> Result<UsageStatus, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        while let Some(usage) = state.memory_usage.first().cloned() {
            if let Err(error) = self.library(&mut state)?.record_usage(&usage) {
                state.library = None;
                return Err(error);
            }
            state.memory_usage.remove(0);
        }
        self.library(&mut state)?.usage_status()
    }
    pub fn library_copy(
        &self,
        request: CopyRequest,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<CopyResult, String> {
        let _clipboard = self.clipboard.try_lock().map_err(|_| "clipboard_busy")?;
        let mut state = self.state.try_lock().map_err(|_| "clipboard_busy")?;
        let retained = state.retained.as_ref().ok_or("authentication_required")?;
        if state.signing_out
            || request.generation != state.generation
            || request.instance_id != retained.identity.instance.id
            || request.account_id != retained.identity.account.id
        {
            return Err("operation_cancelled".into());
        }
        let prompt = self.library(&mut state)?.detail(&request.prompt_id)?;
        // No database transaction spans the OS call. The partition lock prevents transitions.
        write(&prompt.content)?;
        let usage = Usage {
            id: uuid::Uuid::new_v4().to_string(),
            prompt_id: prompt.id,
            occurred_at: super::usage_contract::occurrence_time(),
        };
        let saved = self.library(&mut state)?.record_usage(&usage).is_ok();
        if !saved {
            state.memory_usage.push(usage);
            state.library = None;
        }
        Ok(CopyResult {
            origin: request,
            usage_saved: saved,
        })
    }
    pub fn library_recents(&self, offset: u32) -> Result<Vec<Summary>, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.recents(offset)
    }
    pub fn library_usage_status(&self) -> Result<UsageStatus, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        let mut status = self.library(&mut state)?.usage_status()?;
        status.memory_only = state.memory_usage.len();
        Ok(status)
    }
}
