impl LibraryStore {
    pub fn retained_prompt(&self, id: &str) -> Result<Prompt, String> {
        if !super::local_contract::uuid4(id) {
            return Err("invalid_input".into());
        }
        let record:Option<String>=self.db.query_row("SELECT record FROM local_prompt WHERE id=?1 AND EXISTS(SELECT 1 FROM outbox WHERE prompt_id=?1)",[id],|r|r.get(0)).optional().map_err(io)?;
        serde_json::from_str(&record.ok_or("prompt_unavailable")?)
            .map_err(|_| "storage_unavailable".into())
    }
    pub fn recover(
        &mut self,
        request: super::lifecycle_contract::RecoveryRequest,
    ) -> Result<(), String> {
        use super::lifecycle_contract::RecoveryAction;
        if !super::local_contract::uuid4(&request.prompt_id) {
            return Err("invalid_input".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        match request.action {
            RecoveryAction::Retry => {
                // Keep frozen envelopes and server rejection evidence until the outcome
                // is resolved. Retrying never changes an operation's identity or payload.
                tx.execute("UPDATE outbox SET next_attempt=0 WHERE prompt_id=?1 AND state<>'accepted_awaiting_download'",[&request.prompt_id]).map_err(io)?;
                tx.execute(
                    "UPDATE upload_state SET next_attempt=0,attempts=0,error=NULL",
                    [],
                )
                .map_err(io)?;
            }
            RecoveryAction::Discard => {
                if !request.confirmed {
                    return Err("confirmation_required".into());
                }
                let uncertain:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE prompt_id=?1 AND state='in_flight' AND error IS NULL)",[&request.prompt_id],|r|r.get(0)).map_err(io)?;
                if uncertain {
                    return Err("delivery_uncertain".into());
                }
                let accepted:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE prompt_id=?1 AND state='accepted_awaiting_download')",[&request.prompt_id],|r|r.get(0)).map_err(io)?;
                if accepted {
                    return Err("accepted_effect_pending_download".into());
                }
                let dependent:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox child,json_each(child.payload,'$.dependsOn') d JOIN outbox parent ON parent.id=d.value WHERE parent.prompt_id=?1 AND child.prompt_id<>?1)",[&request.prompt_id],|r|r.get(0)).map_err(io)?;
                if dependent {
                    return Err("dependent_changes_pending".into());
                }
                tx.execute(
                    "DELETE FROM outbox WHERE prompt_id=?1",
                    [&request.prompt_id],
                )
                .map_err(io)?;
                super::local_search::remove(&tx, &request.prompt_id).map_err(io)?;
                tx.execute("DELETE FROM local_prompt WHERE id=?1", [&request.prompt_id])
                    .map_err(io)?;
                tx.execute(
                    "DELETE FROM local_deleted WHERE id=?1",
                    [&request.prompt_id],
                )
                .map_err(io)?;
                tx.execute("UPDATE local_state SET revision=revision+1", [])
                    .map_err(io)?;
            }
        }
        tx.commit().map_err(io)
    }
}
