impl AuthService {
    pub fn library_adjustments(&self, offset: u32) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.adjustments(offset)
    }
    pub fn library_review_adjustment(
        &self,
        request: super::conflict_contract::ReviewConflict,
    ) -> Result<(), String> {
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
        self.library(&mut state)?
            .review_adjustment(&request.notice_id)?;
        self.wake_sync();
        Ok(())
    }
    pub fn library_refresh_adjustments(&self) -> Result<(), String> {
        let generation = self
            .state
            .lock()
            .map_err(|_| "state_unavailable")?
            .generation;
        let result = self.fetch_adjustments();
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation == generation && state.retained.is_some() && !state.clearing {
            self.library(&mut state)?
                .adjustment_error(result.as_ref().err().map(String::as_str))?;
        }
        result
    }
    fn fetch_adjustments(&self) -> Result<(), String> {
        let (generation, envelope) = {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
            (
                state.generation,
                state.credential.clone().ok_or("authentication_required")?,
            )
        };
        let mut request = json!({"limit":100});
        {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation != generation {
                return Err("operation_cancelled".into());
            }
            self.library(&mut state)?.begin_attention("adjustments")?;
        }
        let mut revision: Option<String> = None;
        let mut cursors = std::collections::HashSet::new();
        loop {
            let page: super::conflict_contract::AdjustmentPage = decode(self.snapshot_request(
                generation,
                &envelope,
                Endpoint::Adjustments,
                request,
            )?)?;
            if page.instance_id != envelope.instance_id
                || page.account_id != envelope.account_id
                || page.notices.len() > 100
                || revision.as_ref().is_some_and(|r| *r != page.revision)
            {
                return Err("invalid_response".into());
            }
            let head = super::change_contract::revision(&page.revision)?;
            revision = Some(page.revision);
            for notice in &page.notices {
                if !super::local_contract::uuid4(&notice.id)
                    || !super::local_contract::uuid4(&notice.prompt_id)
                    || notice.message.len() > 4096
                    || chrono::DateTime::parse_from_rfc3339(&notice.created_at).is_err()
                    || super::change_contract::revision(&notice.revision)? > head
                {
                    return Err("invalid_response".into());
                }
            }
            {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != generation {
                    return Err("operation_cancelled".into());
                }
                self.library(&mut state)?
                    .stage_attention("adjustments", &page.notices)?;
            }
            let Some(cursor) = page.next_cursor else {
                break;
            };
            if cursor.is_empty() || cursor.len() > 2048 || !cursors.insert(cursor.clone()) {
                return Err("invalid_response".into());
            }
            request = json!({"limit":100,"cursor":cursor});
        }
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        self.library(&mut state)?
            .finish_attention("adjustments", &revision.ok_or("invalid_response")?)
    }
    pub fn library_refresh_conflicts(&self) -> Result<(), String> {
        let generation = self
            .state
            .lock()
            .map_err(|_| "state_unavailable")?
            .generation;
        let result = self.fetch_conflicts();
        if let Err(error) = &result {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation == generation && state.retained.is_some() && !state.clearing {
                self.library(&mut state)?.conflict_error(Some(error))?;
            }
        }
        result
    }
    fn fetch_conflicts(&self) -> Result<(), String> {
        let (generation, envelope) = {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
            (
                state.generation,
                state.credential.clone().ok_or("authentication_required")?,
            )
        };
        let mut request = json!({"limit":100});
        {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation != generation {
                return Err("operation_cancelled".into());
            }
            self.library(&mut state)?.begin_attention("conflicts")?;
        }
        let mut revision: Option<String> = None;
        let mut cursors = std::collections::HashSet::new();
        loop {
            let page: super::conflict_contract::ConflictPage = decode(self.snapshot_request(
                generation,
                &envelope,
                Endpoint::Conflicts,
                request,
            )?)?;
            if page.instance_id != envelope.instance_id
                || page.account_id != envelope.account_id
                || page.notices.len() > 100
                || revision.as_ref().is_some_and(|r| *r != page.revision)
            {
                return Err("invalid_response".into());
            }
            let head = super::change_contract::revision(&page.revision)?;
            revision = Some(page.revision);
            for notice in &page.notices {
                notice.validate()?;
                if super::change_contract::revision(&notice.revision)? > head {
                    return Err("invalid_response".into());
                }
            }
            {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != generation {
                    return Err("operation_cancelled".into());
                }
                self.library(&mut state)?
                    .stage_attention("conflicts", &page.notices)?;
            }
            let Some(cursor) = page.next_cursor else {
                break;
            };
            if cursor.is_empty() || cursor.len() > 2048 || !cursors.insert(cursor.clone()) {
                return Err("invalid_response".into());
            }
            request = json!({"limit":100,"cursor":cursor});
        }
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        self.library(&mut state)?
            .finish_attention("conflicts", &revision.ok_or("invalid_response")?)?;
        self.library(&mut state)?.conflict_error(None)
    }
    pub fn library_conflicts(&self, offset: u32) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.conflicts(offset)
    }
    pub fn library_review_conflict(
        &self,
        request: super::conflict_contract::ReviewConflict,
    ) -> Result<(), String> {
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
        self.library(&mut state)?
            .review_conflict(&request.notice_id)?;
        self.wake_sync();
        Ok(())
    }
}
