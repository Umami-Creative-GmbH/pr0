// Diagnostic only: run against a disposable copy, never a user's library.
use rusqlite::Connection;
use serde_json::json;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err(
            "Pass a disposable database and full/index-only/mmap/memory/no-memstatus mode".into(),
        );
    }
    let mode = args[1].as_str();
    if !["full", "index-only", "mmap", "memory", "no-memstatus"].contains(&mode) {
        return Err("Unknown diagnostic mode".into());
    }
    if mode == "no-memstatus" {
        // Only this single-threaded diagnostic binary configures SQLite before initialization.
        let result =
            unsafe { rusqlite::ffi::sqlite3_config(rusqlite::ffi::SQLITE_CONFIG_MEMSTATUS, 0) };
        if result != rusqlite::ffi::SQLITE_OK {
            return Err("SQLite memory-status configuration failed".into());
        }
    }
    let db = Connection::open(&args[0])?;
    db.busy_timeout(std::time::Duration::from_millis(250))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-16384;")?;
    if mode == "mmap" {
        db.execute_batch("PRAGMA mmap_size=268435456;")?;
    } else {
        db.execute_batch("PRAGMA mmap_size=0;")?;
    }
    if mode == "memory" {
        db.execute_batch("PRAGMA temp_store=MEMORY;")?;
    }
    let rank = if mode == "index-only" { 0 } else { 1 };
    let mut fields = Vec::new();
    let started = Instant::now();
    for field in ["title", "description", "content", "name"] {
        let sample = Instant::now();
        db.execute_batch(&format!(
            "INSERT INTO local_f_{field}(local_f_{field},rank) VALUES('integrity-check',{rank});"
        ))?;
        fields.push(json!({"field":field,"ms":sample.elapsed().as_secs_f64()*1000.0}));
    }
    println!(
        "{}",
        json!({"sqliteVersion":rusqlite::version(),"win32Heap":db.query_row("SELECT sqlite_compileoption_used('WIN32_MALLOC')", [], |r| r.get::<_, bool>(0))?,"mode":mode,"fullContentComparison":rank==1,"fields":fields,"totalMs":started.elapsed().as_secs_f64()*1000.0})
    );
    Ok(())
}
