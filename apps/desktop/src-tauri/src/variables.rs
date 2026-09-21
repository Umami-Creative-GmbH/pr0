use std::collections::HashMap;

const LIMIT: usize = 262_144;

enum Segment<'a> {
    Text(&'a str),
    Variable(&'a str),
}

fn annotation(token: &str) -> Option<(&str, bool)> {
    let inner = token.strip_prefix("{{")?.strip_suffix("}}")?;
    let mut parts = inner.split('|');
    let name = parts.next()?.trim_matches([' ', '\t']);
    let mut chars = name.chars();
    if !chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return None;
    }
    let number = match parts.next().map(|s| s.trim_matches([' ', '\t'])) {
        None | Some("string") => false,
        Some("number") => true,
        _ => return None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some((name, number))
}

fn decimal(value: &str) -> bool {
    let text = value.trim_matches([' ', '\t']);
    let text = text.strip_prefix(['+', '-']).unwrap_or(text);
    let mut parts = text.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    parts.next().is_none()
        && whole.bytes().all(|c| c.is_ascii_digit())
        && match fraction {
            Some(part) => !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()),
            None => !whole.is_empty(),
        }
}

fn whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{0085}' | '\u{00A0}' |
        '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' |
        '\u{205F}' | '\u{3000}')
}

/// Values are borrowed only for this operation; never persisted or included in errors.
pub fn substitute(content: &str, values: &[(String, String)]) -> Result<String, String> {
    let bytes = content.as_bytes();
    let mut cursor = 0;
    let mut literal = 0;
    let mut segments = Vec::new();
    let mut fields: HashMap<&str, bool> = HashMap::new();
    while cursor + 1 < bytes.len() {
        if &bytes[cursor..cursor + 2] != b"{{" {
            cursor += 1;
            continue;
        }
        let start = cursor;
        let mut balance = 0_i32;
        while cursor < bytes.len() && !matches!(bytes[cursor], b'\r' | b'\n') {
            if bytes[cursor] == b'}' {
                while cursor < bytes.len() && bytes[cursor] == b'}' {
                    balance -= 1;
                    cursor += 1;
                }
                if balance <= 0 {
                    break;
                }
            } else {
                if bytes[cursor] == b'{' {
                    balance += 1;
                }
                cursor += 1;
            }
        }
        let token = &content[start..cursor];
        if let Some((name, number)) = annotation(token) {
            let escaped = start > 0 && bytes[start - 1] == b'\\';
            segments.push(Segment::Text(
                &content[literal..start - usize::from(escaped)],
            ));
            if escaped {
                segments.push(Segment::Text(token));
            } else {
                fields
                    .entry(name)
                    .and_modify(|n| *n |= number)
                    .or_insert(number);
                segments.push(Segment::Variable(name));
            }
            literal = cursor;
        }
    }
    segments.push(Segment::Text(&content[literal..]));
    let mut supplied = HashMap::new();
    for (name, value) in values {
        if !fields.contains_key(name.as_str())
            || supplied.insert(name.as_str(), value.as_str()).is_some()
        {
            return Err("invalid_variable_values".into());
        }
    }
    for (name, number) in fields {
        let value = supplied.get(name).copied().unwrap_or("");
        // Rust strings and serde reject invalid Unicode scalars, including lone UTF-16 surrogates.
        if value.contains('\0')
            || value.chars().all(whitespace)
            || value.len() > LIMIT
            || number && !decimal(value)
        {
            return Err("invalid_variable_values".into());
        }
    }
    let mut output = String::new();
    for segment in segments {
        let text = match segment {
            Segment::Text(text) => text,
            Segment::Variable(name) => supplied[name],
        };
        if output.len() + text.len() > LIMIT {
            return Err("variable_output_too_large".into());
        }
        output.push_str(text);
    }
    Ok(output)
}
