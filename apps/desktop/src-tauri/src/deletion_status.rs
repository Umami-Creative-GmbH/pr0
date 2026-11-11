use super::auth_contract::{valid_id, Retained};
use serde::{Deserialize, Serialize};

const INVALID: &str = "invalid_deletion_evidence";

/// The instance's answer for a retained deletion handle (ADR-0005). The
/// instance's own TLS-verified origin is the authority; nothing is signed.
#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Lookup {
    Deleted {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "deletedAt")]
        deleted_at: String,
    },
    Absent,
}

/// A deletion the instance confirmed for the retained account. Persisted before
/// cleanup so an interrupted cleanup resumes after restart.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Confirmed {
    pub account_id: String,
    pub deleted_at: String,
}

fn valid_time(value: &str) -> bool {
    value.len() <= 32 && value.ends_with('Z') && chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

impl Confirmed {
    pub fn validate(&self, retained: &Retained) -> Result<(), String> {
        if !valid_id(&self.account_id)
            || self.account_id != retained.identity.account.id
            || !valid_time(&self.deleted_at)
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

/// Only a deletion of exactly this account authorizes cleanup. Absence never
/// does: after a restore the instance may not know a deletion until its
/// operator re-applies it.
pub fn confirmed(lookup: Lookup, retained: &Retained) -> Result<Option<Confirmed>, String> {
    let Lookup::Deleted {
        account_id,
        deleted_at,
    } = lookup
    else {
        return Ok(None);
    };
    let confirmed = Confirmed {
        account_id,
        deleted_at,
    };
    confirmed.validate(retained)?;
    Ok(Some(confirmed))
}
