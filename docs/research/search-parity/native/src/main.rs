use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Value};
use std::{error::Error, fs, time::Instant};

fn main() -> Result<(), Box<dyn Error>> {
    let db = Connection::open("../parity.sqlite")?;
    let cases: Vec<Value> = serde_json::from_str(&fs::read_to_string("../native-cases.json")?)?;
    let fields = ["title", "content", "description", "tag1", "tag2", "collection"];
    let mut checked = 0;
    for case in &cases {
        let terms: Vec<&str> = case["terms"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        let fts = case["ftsQuery"].as_str().unwrap();
        let mut values = Vec::new();
        let mut conditions = Vec::new();
        if !fts.is_empty() { conditions.push("id IN (SELECT rowid FROM search WHERE search MATCH ?)".to_string()); values.push(fts); }
        for term in terms {
            conditions.push(format!("({})", fields.iter().map(|field| format!("instr({field},?) > 0")).collect::<Vec<_>>().join(" OR ")));
            for _field in fields { values.push(term); }
        }
        if conditions.is_empty() { conditions.push("1".to_string()); }
        let sql = format!("SELECT id FROM prompts WHERE {} ORDER BY id", conditions.join(" AND "));
        let ids = db.prepare(&sql)?.query_map(params_from_iter(values), |row| row.get::<_,i64>(0))?.collect::<Result<Vec<_>,_>>()?;
        assert_eq!(json!(ids), case["expected"], "query {}", case["query"]);
        checked += 1;
    }
    let order = db.prepare("SELECT id FROM prompts ORDER BY title COLLATE BINARY,id")?.query_map([],|row|row.get::<_,i64>(0))?.collect::<Result<Vec<_>,_>>()?;
    let reference: Value=serde_json::from_str(&fs::read_to_string("../results.json")?)?;
    assert_eq!(json!(order),reference["scalarOrder"]);
    let version: String=db.query_row("SELECT sqlite_version()",[],|row|row.get(0))?;
    let mut timings=Vec::new();
    let bench_exists: bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='bench')",[],|row|row.get(0))?;
    if bench_exists {
        for query in ["🫠","🫠x","a","ab","common","zzzzzz"] {
            let long=query.chars().count()>=3;
            let sql=format!("SELECT id FROM bench WHERE {} (instr(title,?)>0 OR instr(content,?)>0) ORDER BY title COLLATE BINARY,id LIMIT 50",if long {"id IN (SELECT rowid FROM bench_fts WHERE bench_fts MATCH ?) AND"} else {""});
            let quoted=format!("\"{}\"", query.replace('"', "\"\""));
            let values=if long {vec![quoted.as_str(),query,query]} else {vec![query,query]};
            let mut statement=db.prepare(&sql)?;
            let mut samples=Vec::new(); let mut count=0;
            for run in 0..21 {
                let start=Instant::now();
                let ids=statement.query_map(params_from_iter(&values),|row|row.get::<_,i64>(0))?.collect::<Result<Vec<_>,_>>()?;
                let elapsed=start.elapsed().as_secs_f64()*1000.0;
                count=ids.len(); if run>0 {samples.push(elapsed);}
            }
            samples.sort_by(f64::total_cmp);
            timings.push(json!({"query":query,"count":count,"min":samples[0],"p50":samples[9],"p95":samples[18],"max":samples[19]}));
        }
    }
    let result=json!({"rusqlite":"0.40.2","sqlite":version,"cases":checked,"scalarOrder":order,"timings":timings});
    fs::write("../native-results.json",serde_json::to_string_pretty(&result)?)?;
    println!("Passed {checked} Rust bundled-SQLite parity cases; scalar ordering; native benchmark recorded.");
    Ok(())
}
