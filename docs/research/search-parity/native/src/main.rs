use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Value};
use std::{error::Error, fs, time::Instant};

fn main() -> Result<(), Box<dyn Error>> {
    if std::env::args().any(|arg| arg == "--compact") { return compact_run(); }
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
    let exact_exists: bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='exact_fields')",[],|row|row.get(0))?;
    let mut exact_checks=0;
    if exact_exists {
        let records=db.prepare("SELECT rowid,title,content,description,tag1,tag2,collection FROM exact_fields ORDER BY rowid")?.query_map([],|row| Ok((row.get::<_,i64>(0)?,(1..7).map(|i|row.get::<_,String>(i)).collect::<Result<Vec<_>,_>>()?)))?.collect::<Result<Vec<_>,_>>()?;
        let mut terms: Vec<String>=cases.iter().flat_map(|case|case["terms"].as_array().unwrap().iter().map(|term|term.as_str().unwrap().to_string())).collect();
        for (id, values) in &records {if *id>=1000 {terms.push(values[1].clone());}}
        terms.push("x".repeat(200)); terms.push("a".repeat(200));
        terms.sort(); terms.dedup();
        for term in terms {if term.chars().count()<3 {continue;} for (field_index,field) in fields.iter().enumerate() {
            let expected: Vec<i64>=records.iter().filter(|(_,values)|values[field_index].contains(&term)).map(|(id,_)|*id).collect();
            let expression=format!("{}:\"{}\"",field,term.replace('"',"\"\""));
            let actual=db.prepare("SELECT rowid FROM exact_fields WHERE exact_fields MATCH ? ORDER BY rowid")?.query_map([expression],|row|row.get::<_,i64>(0))?.collect::<Result<Vec<_>,_>>()?;
            assert_eq!(actual,expected,"field {} term {}",field,term);exact_checks+=1;
        }}
    }
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
    let result=json!({"rusqlite":"0.40.2","sqlite":version,"cases":checked,"perFieldExactChecks":exact_checks,"scalarOrder":order,"timings":timings});
    fs::write("../native-results.json",serde_json::to_string_pretty(&result)?)?;
    println!("Passed {checked} Rust bundled-SQLite parity cases; scalar ordering; native benchmark recorded.");
    Ok(())
}



fn compact_run() -> Result<(), Box<dyn Error>> {
    let db=Connection::open("../compact-parity.sqlite")?;
    let fields=["title","content","description","tag1","tag2","collection"];
    let terms=["C++","c++","abcd","*x?","[literal]","😀a😀","100%","under_score","\\","[]"];
    let mut count=0;
    for field in fields {
        let table=format!("f_{field}");
        let records=db.prepare(&format!("SELECT rowid,value FROM {table} ORDER BY rowid"))?.query_map([],|row|Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
        for term in terms {
            let expected:Vec<i64>=records.iter().filter(|(_,value)|value.contains(term)).map(|(id,_)|*id).collect();
            let points:Vec<char>=term.chars().collect();
            let mut trigrams=Vec::new();
            for window in points.windows(3) {trigrams.push(window.iter().collect::<String>());}
            trigrams.sort();trigrams.dedup();
            let expression=trigrams.iter().map(|gram|format!("\"{}\"",gram.replace('"',"\"\""))).collect::<Vec<_>>().join(" AND ");
            let sql=if points.len()>=3 {format!("SELECT rowid FROM {table} WHERE {table} MATCH ? AND instr(value,?)>0 ORDER BY rowid")}else{format!("SELECT rowid FROM {table} WHERE instr(value,?)>0 ORDER BY rowid")};
            let parameters=if points.len()>=3 {vec![expression.as_str(),term]}else{vec![term]};
            let actual=db.prepare(&sql)?.query_map(params_from_iter(parameters),|row|row.get::<_,i64>(0))?.collect::<Result<Vec<_>,_>>()?;
            assert_eq!(actual,expected,"{field} {term}");count+=1;
        }
    }
    let version:String=db.query_row("SELECT sqlite_version()",[],|row|row.get(0))?;
    let result=json!({"rusqlite":"0.40.2","sqlite":version,"compactChecks":count,"includesFalsePositiveRecheck":true});
    fs::write("../compact-native-results.json",serde_json::to_string_pretty(&result)?)?;
    println!("Passed {count} native compact-index predicate checks.");
    Ok(())
}
