use super::auth_contract::*;
pub use super::auth_storage::Credentials;
use super::auth_storage::Metadata;
use super::auth_transport::canonical_origin;
pub use super::auth_transport::{Endpoint, Transport};
use super::library_contract::{LibraryStatus, Manifest, Page, Prompt, Summary};
use super::library_storage::LibraryStore;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthView {
    state: &'static str,
    generation: u64,
    origin: Option<String>,
    email: Option<String>,
    account_id: Option<String>,
    instance_id: Option<String>,
    user_code: Option<String>,
    message: String,
    poll_after_ms: u64,
}
struct Attempt {
    trust: Capabilities,
    code: DeviceCode,
    expires: Instant,
    next_poll: Instant,
    polling: bool,
}
struct State {
    next_download: Instant,
    memory_usage: Vec<super::usage_contract::Usage>,
    library: Option<LibraryStore>,
    generation: u64,
    retained: Option<Retained>,
    credential: Option<Envelope>,
    attempt: Option<Attempt>,
    message: String,
    storage: Metadata,
    clearing: bool,
    signing_out: bool,
    restore_pending: bool,
}
pub struct AuthService {
    wake: (Mutex<u64>, Condvar),
    changes: Mutex<()>,
    clipboard: Mutex<()>,
    transition: Mutex<()>,
    upload: Mutex<()>,
    download: Mutex<()>,
    state: Mutex<State>,
    restoration: Mutex<()>,
    transport: Arc<dyn Transport>,
    credentials: Arc<dyn Credentials>,
    directory: PathBuf,
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| "invalid_response".into())
}
include!("library_commands.rs");
include!("upload_commands.rs");
include!("change_commands.rs");
include!("usage_commands.rs");
include!("deletion_commands.rs");
impl State {
    fn view(&self) -> AuthView {
        let identity = self.retained.as_ref().map(|r| &r.identity);
        let state = if self.clearing || self.retained.as_ref().is_some_and(|r| r.cleanup_pending) {
            "cleanup_required"
        } else if self.signing_out {
            "synchronizing_sign_out"
        } else if self.attempt.is_some() {
            "awaiting_approval"
        } else if self.credential.is_some() {
            "signed_in"
        } else if self.retained.is_some() {
            "authentication_required"
        } else {
            "signed_out"
        };
        AuthView {
            state,
            generation: self.generation,
            origin: self
                .attempt
                .as_ref()
                .map(|a| a.trust.origin.clone())
                .or_else(|| identity.map(|i| i.instance.origin.clone())),
            email: identity.map(|i| i.account.email.clone()),
            account_id: identity.map(|i| i.account.id.clone()),
            instance_id: identity.map(|i| i.instance.id.clone()),
            user_code: self.attempt.as_ref().map(|a| a.code.user_code.clone()),
            message: self.message.clone(),
            poll_after_ms: self
                .attempt
                .as_ref()
                .map(|a| {
                    a.next_poll
                        .saturating_duration_since(Instant::now())
                        .as_millis() as u64
                })
                .unwrap_or(0),
        }
    }
}
impl AuthService {
    pub fn new(
        directory: PathBuf,
        transport: Arc<dyn Transport>,
        credentials: Arc<dyn Credentials>,
    ) -> Result<Self, String> {
        let storage = Metadata::open(&directory)?;
        let retained = storage.read()?;
        if let Some(record) = &retained {
            if record.version != 1 || canonical_origin(&record.trust.origin)? != record.trust.origin
            {
                return Err("retained_identity_invalid".into());
            }
            record.trust.validate(&record.trust.origin)?;
            record.identity.validate(&record.trust)?;
            if let Some(proof) = &record.deletion_proof {
                if !record.cleanup_pending {
                    return Err("retained_identity_invalid".into());
                }
                super::deletion_proof::verify(proof, record)?;
            }
        }
        let credential = credentials
            .read()
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Envelope>(&bytes).ok())
            .filter(|e| {
                retained.as_ref().is_some_and(|r| {
                    !r.cleanup_pending
                        && !r.authentication_required
                        && !r.identity.expired()
                        && e.version == 1
                        && e.origin == r.identity.instance.origin
                        && e.instance_id == r.identity.instance.id
                        && e.account_id == r.identity.account.id
                        && e.session_id == r.identity.session.id
                        && valid_token(&e.token)
                })
            });
        let message = if retained.is_some() && credential.is_none() {
            "Sign in to resume. Retained local files are preserved.".into()
        } else {
            String::new()
        };
        Ok(Self {
            clipboard: Mutex::new(()),
            transition: Mutex::new(()),
            upload: Mutex::new(()),
            wake: (Mutex::new(0), Condvar::new()),
            changes: Mutex::new(()),
            download: Mutex::new(()),
            restoration: Mutex::new(()),
            state: Mutex::new(State {
                next_download: Instant::now(),
                memory_usage: vec![],
                library: None,
                generation: 1,
                restore_pending: retained.is_some(),
                retained,
                credential,
                attempt: None,
                message,
                storage,
                clearing: false,
                signing_out: false,
            }),
            transport,
            credentials,
            directory,
        })
    }
    pub fn status(&self) -> Result<AuthView, String> {
        Ok(self.state.lock().map_err(|_| "state_unavailable")?.view())
    }
    pub fn restore(&self) -> Result<AuthView, String> {
        let _restoration = self.restoration.lock().map_err(|_| "state_unavailable")?;
        let pending = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            std::mem::take(&mut state.restore_pending)
        };
        if pending {
            // A failed online check records a safe status and preserves local files.
            // In particular, a server-side revocation requires authentication again.
            let _ = self.refresh();
        }
        self.status()
    }
    pub fn begin(&self, input: &str) -> Result<AuthView, String> {
        let origin = canonical_origin(input)?;
        let generation = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.clearing
                || state.signing_out
                || state.credential.is_some()
                || state.attempt.is_some()
                || state.retained.as_ref().is_some_and(|r| r.cleanup_pending)
            {
                return Err("sign_out_first".into());
            }
            if state
                .retained
                .as_ref()
                .is_some_and(|r| r.trust.origin != origin)
            {
                return Err("same_account_required".into());
            }
            state.generation += 1;
            state.message.clear();
            state.generation
        };
        if self.check_deletion()? {
            return self.status();
        }
        let trust: Capabilities =
            decode(
                self.transport
                    .request(&origin, Endpoint::Capabilities, None, None)?,
            )?;
        trust.validate(&origin)?;
        {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation != generation {
                return Err("operation_cancelled".into());
            }
            if state.retained.as_ref().is_some_and(|r| {
                r.trust.instance_id != trust.instance_id
                    || r.trust.deletion_key != trust.deletion_key
            }) {
                return Err("instance_identity_changed".into());
            }
        }
        let code: DeviceCode = decode(self.transport.request(
            &origin,
            Endpoint::Code,
            None,
            Some(json!({ "client_id": "pr0-desktop" })),
        )?)?;
        let expected_url = format!("{origin}/device?user_code={}", code.user_code);
        if code.user_code.len() != 8
            || !code
                .user_code
                .bytes()
                .all(|b| b.is_ascii_uppercase() || (b'2'..=b'9').contains(&b))
            || code.device_code.is_empty()
            || code.device_code.len() > 191
            || code.verification_uri != format!("{origin}/device")
            || code.verification_uri_complete != expected_url
            || code.expires_in == 0
            || code.expires_in > 600
            || code.interval == 0
            || code.interval > 60
        {
            return Err("invalid_response".into());
        }
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        state.attempt = Some(Attempt {
            trust,
            expires: Instant::now() + Duration::from_secs(code.expires_in),
            next_poll: Instant::now() + Duration::from_secs(code.interval),
            code,
            polling: false,
        });
        if self.transport.open_browser(&expected_url).is_err() {
            state.message = "The browser could not open. Choose Open browser to retry.".into();
        }
        Ok(state.view())
    }
    pub fn open_browser(&self) -> Result<AuthView, String> {
        let state = self.state.lock().map_err(|_| "state_unavailable")?;
        let attempt = state.attempt.as_ref().ok_or("approval_required")?;
        self.transport
            .open_browser(&attempt.code.verification_uri_complete)?;
        Ok(state.view())
    }
    pub fn poll(&self) -> Result<AuthView, String> {
        let (generation, trust, code) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let generation = state.generation;
            let Some(attempt) = &mut state.attempt else {
                return Ok(state.view());
            };
            if Instant::now() >= attempt.expires {
                state.attempt = None;
                state.message = "Approval expired. Start a new sign-in.".into();
                return Ok(state.view());
            }
            if attempt.polling || Instant::now() < attempt.next_poll {
                return Ok(state.view());
            }
            attempt.polling = true;
            (generation, attempt.trust.clone(), attempt.code.clone())
        };
        let result = self.redeem(&trust, &code);
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        match result {
            Ok(None) => {
                if let Some(attempt) = &mut state.attempt {
                    attempt.polling = false;
                    attempt.next_poll = Instant::now() + Duration::from_secs(code.interval + 5);
                }
            }
            Ok(Some((identity, envelope))) => {
                state.attempt = None;
                if state.retained.as_ref().is_some_and(|r| {
                    r.identity.account.id != identity.account.id
                        || r.identity.deletion_handle != identity.deletion_handle
                }) {
                    state.attempt = None;
                    return Err("same_account_required".into());
                }
                // Metadata is durable before the credential. A crash between these writes
                // requests authentication on restart and never discards retained files.
                let retained = Retained {
                    deletion_proof: None,
                    version: 1,
                    identity,
                    trust,
                    cleanup_pending: false,
                    authentication_required: true,
                };
                state.storage.save(&retained)?;
                state.retained = Some(retained);
                state.attempt = None;
                let bytes = serde_json::to_vec(&envelope).map_err(|_| "credential_invalid")?;
                if bytes.len() > 2560 {
                    return Err("credential_too_large".into());
                }
                if let Err(error) = self.credentials.write(&bytes) {
                    state.message = "Windows could not confirm credential storage. Sign in again to retry; local work is preserved.".into();
                    return Err(error);
                }
                let mut retained = state.retained.clone().ok_or("authentication_required")?;
                retained.authentication_required = false;
                state.storage.save(&retained)?;
                state.retained = Some(retained);
                state.credential = Some(envelope);
                state.message = "Signed in on this computer.".into();
            }
            Err(error) => {
                state.attempt = None;
                state.message = "Approval did not complete. Start a new sign-in; local files are preserved. An undelivered session can be revoked in browser settings.".into();
                return Err(error);
            }
        }
        Ok(state.view())
    }
    fn redeem(
        &self,
        trust: &Capabilities,
        code: &DeviceCode,
    ) -> Result<Option<(Identity, Envelope)>, String> {
        let value = self.transport.request(&trust.origin, Endpoint::Token, None, Some(json!({
            "client_id": "pr0-desktop", "device_code": code.device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        })))?;
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            return if error == "authorization_pending" || error == "slow_down" {
                Ok(None)
            } else {
                Err("approval_failed".into())
            };
        }
        let token: Token = decode(value)?;
        if !valid_token(&token.access_token)
            || token.token_type != "Bearer"
            || !token.scope.is_empty()
            || token.expires_in > 2592000
        {
            return Err("invalid_response".into());
        }
        let identity: Identity = decode(self.transport.request(
            &trust.origin,
            Endpoint::Session,
            Some(&token.access_token),
            None,
        )?)?;
        identity.validate(trust)?;
        let envelope = Envelope {
            version: 1,
            origin: trust.origin.clone(),
            instance_id: identity.instance.id.clone(),
            account_id: identity.account.id.clone(),
            session_id: identity.session.id.clone(),
            token: token.access_token,
        };
        Ok(Some((identity, envelope)))
    }
    pub fn cancel(&self) -> Result<AuthView, String> {
        let attempt = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            state.generation += 1;
            state.message = "Approval cancelled. You can start again.".into();
            state.attempt.take()
        };
        if let Some(attempt) = attempt {
            let _ = self.transport.request(
                &attempt.trust.origin,
                Endpoint::Cancel,
                None,
                Some(
                    json!({ "client_id": "pr0-desktop", "device_code": attempt.code.device_code }),
                ),
            );
        }
        self.status()
    }
    pub fn refresh(&self) -> Result<AuthView, String> {
        if self.check_deletion()? {
            return self.status();
        }
        self.refresh_session()
    }
    fn refresh_session(&self) -> Result<AuthView, String> {
        let (generation, envelope, trust) = {
            let state = self.state.lock().map_err(|_| "state_unavailable")?;
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
        let result = self
            .transport
            .request(
                &envelope.origin,
                Endpoint::Session,
                Some(&envelope.token),
                None,
            )
            .and_then(decode::<Identity>);
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        match result {
            Ok(identity) => {
                identity.validate(&trust)?;
                if identity.account.id != envelope.account_id
                    || identity.session.id != envelope.session_id
                    || state
                        .retained
                        .as_ref()
                        .is_some_and(|r| r.identity.deletion_handle != identity.deletion_handle)
                {
                    return Err("same_account_required".into());
                }
                let retained = Retained {
                    deletion_proof: None,
                    version: 1,
                    identity,
                    trust,
                    cleanup_pending: false,
                    authentication_required: false,
                };
                state.storage.save(&retained)?;
                state.retained = Some(retained);
                state.message = "Session checked.".into();
            }
            Err(error) => {
                if error == "authentication_required" {
                    state.credential = None;
                    if let Some(retained) = &mut state.retained {
                        retained.authentication_required = true;
                    }
                    if let Some(retained) = &state.retained {
                        state.storage.save(retained)?;
                    }
                }
                state.message = "Could not confirm the session. Local files are preserved; retry when online or sign in again.".into();
                return Err(error);
            }
        }
        Ok(state.view())
    }
    pub fn transition(&self, request: SignOutRequest) -> Result<AuthView, String> {
        request.validate()?;
        {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            let retained = state.retained.as_ref().ok_or("operation_cancelled")?;
            if state.generation != request.generation
                || retained.identity.instance.id != request.instance_id
                || retained.identity.account.id != request.account_id
            {
                return Err("operation_cancelled".into());
            }
            if request.choice == SignOutChoice::Cancel {
                if state.clearing || retained.cleanup_pending {
                    return Err("cleanup_required".into());
                }
                state.generation += 1;
                state.signing_out = false;
                state.message = "Sign-out cancelled. Local work is preserved.".into();
                return Ok(state.view());
            }
            if request.choice == SignOutChoice::RetryCleanup
                && !retained.cleanup_pending
                && !state.clearing
            {
                return Err("cleanup_not_pending".into());
            }
        }
        let _transition = self
            .transition
            .try_lock()
            .map_err(|_| "transition_in_progress")?;
        if request.choice == SignOutChoice::Synchronize {
            {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != request.generation
                    || state.clearing
                    || state.retained.as_ref().is_some_and(|r| r.cleanup_pending)
                {
                    return Err("operation_cancelled".into());
                }
                state.signing_out = true;
                state.message =
                    "Synchronizing before sign-out. Waiting for server acknowledgement.".into();
            }
            if let Err(error) = self.synchronize_before_sign_out(request.generation) {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation == request.generation {
                    state.signing_out = false;
                    state.message = "Synchronization did not complete. Local work is preserved. Retry, cancel, or explicitly discard.".into();
                }
                return Err(error);
            }
        }
        let result =
            self.clear_session(request.generation, request.choice == SignOutChoice::Discard);
        if let Ok(mut state) = self.state.lock() {
            if state.generation == request.generation {
                state.signing_out = false;
            }
        }
        result
    }
    fn synchronize_before_sign_out(&self, generation: u64) -> Result<(), String> {
        // Even an empty outbox is not proof of a successful online synchronization.
        self.refresh()?;
        self.library_retry_usage()?;
        loop {
            let (waiting, usage_waiting) = {
                let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
                if state.generation != generation {
                    return Err("operation_cancelled".into());
                }
                let waiting = self.library(&mut state)?.upload_status()?.waiting;
                let usage_waiting = self.library(&mut state)?.usage_status()?.waiting;
                if waiting == 0 && usage_waiting == 0 {
                    return Ok(());
                }
                (waiting, usage_waiting)
            };
            if !self.library_status()?.complete {
                self.library_download()?;
                continue;
            }
            if waiting == 0 {
                let status = match self.library_sync_usage() {
                    Err(error) if error == "upload_in_progress" => {
                        std::thread::sleep(Duration::from_millis(50));
                        continue;
                    }
                    result => result?,
                };
                if let Some(error) = status.error {
                    return Err(error);
                }
                if status.retry_after_ms > 0 || status.waiting >= usage_waiting {
                    return Err("sync_incomplete".into());
                }
                continue;
            }
            let status = match self.library_upload() {
                Err(error) if error == "upload_in_progress" => {
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                result => result?,
            };
            if let Some(error) = status.error {
                return Err(error);
            }
            if !status.errors.is_empty() || status.retry_after_ms > 0 || status.waiting >= waiting {
                return Err("sync_incomplete".into());
            }
        }
    }
    #[cfg(test)]
    pub fn sign_out(&self) -> Result<AuthView, String> {
        let generation = self
            .state
            .lock()
            .map_err(|_| "state_unavailable")?
            .generation;
        self.clear_session(generation, false)
    }
    fn clear_session(&self, expected_generation: u64, discard: bool) -> Result<AuthView, String> {
        let (generation, envelope) = {
            let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
            if state.generation != expected_generation {
                return Err("operation_cancelled".into());
            }
            if state
                .retained
                .as_ref()
                .is_some_and(|r| r.deletion_proof.is_some())
            {
                self.finish_deleted_cleanup(&mut state)?;
                return Ok(state.view());
            }
            self.review_library_cleanup(&mut state, discard)?;
            state.generation += 1;
            state.signing_out = false;
            state.clearing = true;
            state.attempt = None;
            if let Some(retained) = &mut state.retained {
                retained.cleanup_pending = true;
            }
            if let Some(retained) = &state.retained {
                state.storage.save(retained)?;
            }
            (state.generation, state.credential.take())
        };
        let revoked = envelope.as_ref().is_some_and(|e| {
            self.transport
                .request(
                    &e.origin,
                    Endpoint::SignOut,
                    Some(&e.token),
                    Some(json!({})),
                )
                .and_then(decode::<Success>)
                .is_ok_and(|response| response.success)
        });
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.generation != generation {
            return Err("operation_cancelled".into());
        }
        self.credentials.delete()?;
        state.library = None;
        for path in self.library_cleanup_paths(&state)? {
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
        state.message = if revoked { "Signed out. The desktop session was revoked." } else { "Signed out locally. Server revocation could not be confirmed; revoke this session from browser settings." }.into();
        Ok(state.view())
    }
}
