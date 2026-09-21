// Included in auth. Identity and transition guards share the SQLite ownership lock.
impl AuthService {
    pub fn library_reconcile(&self) -> Result<(), String> {
        let (generation, envelope, revision, requests) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let envelope = state.credential.clone().ok_or("authentication_required")?;
            let generation = state.generation;
            let store = self.library(&mut state)?;
            let requests = store.organization_reconcile_requests()?;
            if requests.is_empty() {
                return Ok(());
            }
            (
                generation,
                envelope,
                store.status()?.revision.ok_or("snapshot_required")?,
                requests,
            )
        };
        let mut responses = vec![];
        for request in requests {
            responses.push(decode(self.snapshot_request(
                generation,
                &envelope,
                Endpoint::OrganizationStates,
                request,
            )?)?);
        }
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        self.library(&mut state)?
            .reconcile_organization(&revision, responses)
    }
    pub fn library_organization_browse(
        &self,
        request: super::organization_contract::OrganizationBrowse,
    ) -> Result<Vec<Summary>, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.organization_browse(request)
    }
    pub fn library_organization_impact(
        &self,
        action: super::organization_contract::OrganizationAction,
        replaces: Option<String>,
    ) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?
            .organization_impact(action, replaces)
    }
    pub fn library_organization_review(&self, id: &str, offset: u32) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.organization_review(id, offset)
    }
    pub fn library_organization(&self) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        self.library(&mut state)?.organization_snapshot()
    }
    pub fn library_organize(
        &self,
        request: super::organization_contract::OrganizeRequest,
    ) -> Result<Value, String> {
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
        self.library(&mut state)?.organize(request)
    }
}
