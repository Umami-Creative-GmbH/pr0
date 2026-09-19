use rusqlite::{params, Connection, ErrorCode, TransactionBehavior};
use std::{error::Error,path::Path,process::{Command,Stdio},time::{Duration,Instant}};
use windows_sys::Win32::{Foundation::{GetLastError,ERROR_NOT_FOUND},Security::Credentials::*};
type Result<T> = std::result::Result<T,Box<dyn Error>>;
fn open(path: &Path)->Result<Connection>{
 let c=Connection::open(path)?;
 c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")?;
 c.busy_timeout(Duration::from_millis(150))?; Ok(c)
}
fn schema(c:&Connection)->Result<()>{c.execute_batch("CREATE TABLE IF NOT EXISTS prompts(id TEXT PRIMARY KEY,content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,prompt_id TEXT NOT NULL REFERENCES prompts(id),content TEXT NOT NULL); PRAGMA user_version=1;")?;Ok(())}
fn counts(c:&Connection)->Result<(i64,i64)>{Ok((c.query_row("SELECT count(*) FROM prompts",[],|r|r.get(0))?,c.query_row("SELECT count(*) FROM pending",[],|r|r.get(0))?))}
fn save(c:&mut Connection,id:&str,content:&str,fail:bool)->Result<()>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
 tx.execute("INSERT INTO prompts VALUES (?1,?2)",params![id,content])?;
 if fail{return Err("injected failure".into());}
 tx.execute("INSERT INTO pending VALUES (?1,?1,?2)",params![id,content])?;tx.commit()?;Ok(())
}
fn crash_worker(dir:&Path,phase:&str)->Result<()>{
 let mut c=open(&dir.join(format!("{phase}.db")))?;schema(&c)?;
 if phase.starts_with("migration-") {
  save(&mut c,"existing","unsynced saved prompt",false)?;
  let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
  tx.execute_batch("ALTER TABLE prompts ADD COLUMN description TEXT; PRAGMA user_version=2;")?;
  if phase=="migration-after-commit" {tx.commit()?;}
  std::fs::write(dir.join(format!("{phase}.ready")),b"ready")?;
  loop {std::thread::sleep(Duration::from_millis(50));}
 }
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
 tx.execute("INSERT INTO prompts VALUES ('a','saved text')",[])?;
 if phase!="after-prompt"{tx.execute("INSERT INTO pending VALUES ('op','a','saved text')",[])?;}
 if phase=="after-commit"{tx.commit()?;}
 std::fs::write(dir.join(format!("{phase}.ready")),b"ready")?;
 loop{std::thread::sleep(Duration::from_millis(50));}
}
fn crashes(dir:&Path)->Result<()>{
 for phase in ["after-prompt","before-commit","after-commit","migration-before-commit","migration-after-commit"]{
  let mut child=Command::new(std::env::current_exe()?).args(["crash-worker",dir.to_str().ok_or("path")?,phase]).stdout(Stdio::null()).spawn()?;
  let start=Instant::now();
  while !dir.join(format!("{phase}.ready")).exists(){
   if start.elapsed()>Duration::from_secs(15){child.kill()?;child.wait()?;return Err("child ready timeout".into());}
   if child.try_wait()?.is_some(){return Err("child exited early".into());}
   std::thread::sleep(Duration::from_millis(20));
  }
  child.kill()?;child.wait()?;
  let c=open(&dir.join(format!("{phase}.db")))?;
  let expected=if phase=="after-commit" || phase.starts_with("migration-"){(1,1)}else{(0,0)};
  assert_eq!(counts(&c)?,expected);
  if phase.starts_with("migration-") {
   let expected_version=if phase=="migration-after-commit"{2}else{1};
   assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0))?,expected_version);
   assert_eq!(c.prepare("SELECT description FROM prompts").is_ok(),expected_version==2);
  }
  assert_eq!(c.query_row("PRAGMA integrity_check",[],|r|r.get::<_,String>(0))?,"ok");
  println!("PASS process termination {phase}: {expected:?}; integrity ok");
 }Ok(())
}
fn sqlite_checks(dir:&Path)->Result<()>{
 let path=dir.join("atomic.db");let mut c=open(&path)?;schema(&c)?;
 println!("SQLite {}; foreign_keys=ON, WAL, synchronous=FULL",rusqlite::version());
 assert!(save(&mut c,"fail","draft",true).is_err());assert_eq!(counts(&c)?,(0,0));
 save(&mut c,"ok","durable",false)?;drop(c);
 let mut c=open(&path)?;assert_eq!(counts(&c)?,(1,1));
 println!("PASS transaction failure rollback and successful reopen");
 let mut other=open(&path)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
 tx.execute("UPDATE prompts SET content='not committed' WHERE id='ok'",[])?;
 assert_eq!(other.query_row("SELECT content FROM prompts WHERE id='ok'",[],|r|r.get::<_,String>(0))?,"durable");
 let error=other.transaction_with_behavior(TransactionBehavior::Immediate).err().ok_or("writer should be busy")?;
 assert_eq!(error.sqlite_error_code(),Some(ErrorCode::DatabaseBusy));tx.rollback()?;
 save(&mut other,"second","second window",false)?;
 println!("PASS separate connections: committed read, busy writer, retry");
 {let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
 tx.execute_batch("ALTER TABLE prompts ADD COLUMN description TEXT; PRAGMA user_version=2;")?;
 assert!(tx.execute_batch("INSERT INTO nonexistent VALUES (1)").is_err());}
 assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0))?,1);
 assert!(c.prepare("SELECT description FROM prompts").is_err());assert_eq!(counts(&c)?,(2,2));
 {let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
 tx.execute_batch("ALTER TABLE prompts ADD COLUMN description TEXT; PRAGMA user_version=2;")?;tx.commit()?;}
 drop(other);drop(c);let c=open(&path)?;
 assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0))?,2);assert_eq!(counts(&c)?,(2,2));
 println!("PASS failed migration rollback, successful migration, reopen retains pending work");
 let mut full=open(&dir.join("full.db"))?;schema(&full)?;
 let pages:i64=full.query_row("PRAGMA page_count",[],|r|r.get(0))?;full.pragma_update(None,"max_page_count",pages)?;
 let tx=full.transaction_with_behavior(TransactionBehavior::Immediate)?;tx.execute("INSERT INTO prompts VALUES ('a','small prompt')",[])?;
 let error=tx.execute("INSERT INTO pending VALUES ('op','a',zeroblob(1048576))",[]).unwrap_err();
 assert_eq!(error.sqlite_error_code(),Some(ErrorCode::DiskFull));drop(tx);assert_eq!(counts(&full)?,(0,0));
 println!("PASS SQLITE_FULL via max_page_count at pending insert: neither half retained");crashes(dir)?;Ok(())
}
fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain(Some(0)).collect()}
fn credential_write(target:&str,secret:&[u8])->Result<()>{
 let mut target=wide(target);let mut username=wide("pr0-research-generated-test-only");
 let credential=CREDENTIALW{Type:CRED_TYPE_GENERIC,TargetName:target.as_mut_ptr(),CredentialBlobSize:secret.len().try_into()?,CredentialBlob:secret.as_ptr().cast_mut(),Persist:CRED_PERSIST_LOCAL_MACHINE,UserName:username.as_mut_ptr(),..Default::default()};
 if unsafe{CredWriteW(&credential,0)}==0{return Err(std::io::Error::last_os_error().into());}Ok(())
}
fn credential_read(target:&str)->Result<Option<Vec<u8>>>{
 let target=wide(target);let mut credential=std::ptr::null_mut();
 if unsafe{CredReadW(target.as_ptr(),CRED_TYPE_GENERIC,0,&mut credential)}==0{
 if unsafe{GetLastError()}==ERROR_NOT_FOUND{return Ok(None);}return Err(std::io::Error::last_os_error().into());}
 let result=unsafe{std::slice::from_raw_parts((*credential).CredentialBlob,(*credential).CredentialBlobSize as usize).to_vec()};
 unsafe{CredFree(credential.cast());}Ok(Some(result))
}
struct Cleanup(String);
impl Drop for Cleanup{fn drop(&mut self){let target=wide(&self.0);unsafe{CredDeleteW(target.as_ptr(),CRED_TYPE_GENERIC,0);}}}
fn credential_checks()->Result<()>{
 let nonce=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
 let target=format!("Umami-pr0-research/{nonce}/instance-a/account-a");let other=format!("Umami-pr0-research/{nonce}/instance-b/account-a");
 assert!(credential_read(&target)?.is_none());let cleanup=Cleanup(target.clone());let other_cleanup=Cleanup(other.clone());
 let secret=format!("generated-test-only-{nonce}").into_bytes();credential_write(&target,&secret)?;assert_eq!(credential_read(&target)?,Some(secret));
 assert!(credential_read(&other)?.is_none());credential_write(&other,b"other-instance-test-only")?;assert_ne!(credential_read(&target)?,credential_read(&other)?);
 let status=Command::new(std::env::current_exe()?).args(["credential-worker",&target,&nonce.to_string()]).status()?;assert!(status.success());
 credential_write(&target,b"rotated-test-only")?;assert_eq!(credential_read(&target)?,Some(b"rotated-test-only".to_vec()));
 drop(cleanup);drop(other_cleanup);assert!(credential_read(&target)?.is_none());assert!(credential_read(&other)?.is_none());
 println!("PASS generated credentials: missing, write/read, instance partition, new-process read, replace, delete");Ok(())
}
fn main()->Result<()>{
 let args:Vec<String>=std::env::args().collect();
 if args.get(1).map(String::as_str)==Some("crash-worker"){return crash_worker(Path::new(&args[2]),&args[3]);}
 if args.get(1).map(String::as_str)==Some("credential-worker"){assert_eq!(credential_read(&args[2])?,Some(format!("generated-test-only-{}",args[3]).into_bytes()));return Ok(());}
 let nonce=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();let dir=std::env::current_dir()?.join("run-data").join(nonce.to_string());std::fs::create_dir_all(&dir)?;
 sqlite_checks(&dir)?;credential_checks()?;println!("Evidence databases retained at {}",dir.display());Ok(())
}
