// Included in auth: lock the active partition only around local transactions.
impl AuthService {
    pub fn library_upload_status(&self) -> Result<super::upload_contract::UploadStatus, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.upload_status()
    }
    pub fn library_upload(&self) -> Result<super::upload_contract::UploadStatus, String> {
        let _worker = self.upload.try_lock().map_err(|_| "upload_in_progress")?;
        let (generation, envelope, trust) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let status = self.library(&mut state)?.upload_status()?;
            if status.waiting == 0
                || status.retry_after_ms > 0
                || !self.library(&mut state)?.upload_ready()?
            {
                return Ok(status);
            }
            (
                state.generation,
                state.credential.clone().ok_or("authentication_required")?,
                state
                    .retained
                    .as_ref()
                    .ok_or("authentication_required")?
                    .trust
                    .clone(),
            )
        };
        let result: Result<(), String> = (|| {
            let capabilities: Capabilities = decode(self.snapshot_request(
                generation,
                &envelope,
                Endpoint::Capabilities,
                json!(null),
            )?)?;
            capabilities.validate(&envelope.origin)?;
            if capabilities.instance_id != envelope.instance_id
                || capabilities.deletion_key != trust.deletion_key
            {
                return Err("incompatible_instance".into());
            }
            self.refresh()?;
            let prepared = {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if generation != state.generation {
                    return Err("operation_cancelled".into());
                }
                self.library(&mut state)?.prepare_upload()?
            };
            if let Some((body, replay)) = prepared {
                let response = self.snapshot_request(
                    generation,
                    &envelope,
                    if replay {
                        Endpoint::Receipts
                    } else {
                        Endpoint::Mutations
                    },
                    body.clone(),
                )?;
                let mut response: super::upload_contract::Response = decode(response)?;
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
                    .acknowledge_upload(&body, response.results.remove(0))?;
            }
            Ok(())
        })();
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if generation != state.generation {
            return Err("operation_cancelled".into());
        }
        let store = self.library(&mut state)?;
        match result {
            Ok(()) => store.upload_succeeded()?,
            Err(error) => store.upload_failed(&error)?,
        }
        store.upload_status()
    }
}
