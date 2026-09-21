// Included in auth so proof acceptance and account generation change share one lock.
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
        let lookup: super::deletion_proof::Lookup = decode(self.transport.request(
            &retained.trust.origin,
            Endpoint::DeletionLookup,
            None,
            Some(json!({"handle": retained.identity.deletion_handle})),
        )?)?;
        let super::deletion_proof::Lookup::Deleted { receipt } = lookup else {
            return Ok(false);
        };
        let mut proof = super::deletion_proof::Proof {
            receipt,
            rotations: vec![],
        };
        let mut chain = super::deletion_proof::KeyChain::new(&retained)?;
        let mut page = 0;
        while chain.verify_receipt(&proof.receipt, &retained).is_err() {
            if self
                .state
                .lock()
                .map_err(|_| "state_unavailable")?
                .generation
                != generation
            {
                return Err("operation_cancelled".into());
            }
            let verification: super::deletion_proof::Verification =
                decode(self.transport.request(
                    &retained.trust.origin,
                    Endpoint::DeletionVerification,
                    None,
                    Some(json!({"page":page})),
                )?)?;
            if verification.instance_id != retained.trust.instance_id
                || verification.anchor != retained.trust.deletion_key
                || verification.rotations.len() > super::deletion_proof::VERIFICATION_PAGE_SIZE
                || verification
                    .next_page
                    .is_some_and(|next| next != page + 1 || verification.rotations.is_empty())
            {
                return Err("invalid_deletion_evidence".into());
            }
            chain.extend(&verification.rotations, &retained)?;
            proof.rotations.extend(verification.rotations);
            if verification.next_page.is_none() {
                chain.verify_receipt(&proof.receipt, &retained)?;
                break;
            }
            page += 1;
        }
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
        retained.deletion_proof = Some(proof);
        state.retained = Some(retained);
        state.message =
            "Account deletion verified. Local cleanup must finish; retry cleanup if needed.".into();
        self.wake_sync();
        self.finish_deleted_cleanup(&mut state)?;
        Ok(true)
    }
    fn finish_deleted_cleanup(&self, state: &mut State) -> Result<(), String> {
        let retained = state.retained.as_ref().ok_or("cleanup_required")?;
        super::deletion_proof::verify(
            retained
                .deletion_proof
                .as_ref()
                .ok_or("invalid_deletion_evidence")?,
            retained,
        )?;
        // Persist proof and cleanup intent before destroying anything. Retry is safe after restart.
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
        state.message = "Account deletion verified. This account's local library, pending work and sign-in have been removed.".into();
        Ok(())
    }
}
