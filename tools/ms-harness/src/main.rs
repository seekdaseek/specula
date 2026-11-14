// Runs Microscope's generated decoder (crates/program-decoder, serde + base58, lending.json) over raw
// getTransaction JSON files and prints one JSON line per decoded instruction / event.
// Mirrors processor.rs + instructions.rs::to_log_data + events/mod.rs (to_log_data, snake_case via heck).
use carbon_core::instruction::InstructionDecoder;
use carbon_program_decoder::{instructions::{CpiEvent, ProgramInstruction}, ProgramDecoder, PROGRAM_ID};
use heck::ToSnakeCase;
use serde_json::{json, Value};
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use std::str::FromStr;

const PREFIX: [u8; 8] = [228, 69, 165, 46, 81, 203, 154, 29];

fn ev(e: &CpiEvent) -> Option<(String, Value)> {
    let v = serde_json::to_value(e).ok()?;
    let (k, d) = v.as_object()?.iter().next()?;
    Some((k.to_snake_case(), d.clone()))
}

fn main() {
    for path in std::env::args().skip(1) {
        let tx: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let sig = tx["transaction"]["signatures"][0].as_str().unwrap().to_string();
        let failed = !tx["meta"]["err"].is_null();
        let mut keys: Vec<String> = tx["transaction"]["message"]["accountKeys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_string()).collect();
        for set in ["writable", "readonly"] { if let Some(a) = tx["meta"]["loadedAddresses"][set].as_array() { keys.extend(a.iter().map(|k| k.as_str().unwrap().to_string())); } }
        let pk = |i: usize| Pubkey::from_str(&keys[i]).unwrap();
        let mut flat: Vec<(String, usize, Vec<usize>, Vec<u8>)> = Vec::new();
        for (i, ix) in tx["transaction"]["message"]["instructions"].as_array().unwrap().iter().enumerate() {
            let accts = ix["accounts"].as_array().unwrap().iter().map(|a| a.as_u64().unwrap() as usize).collect();
            flat.push((i.to_string(), ix["programIdIndex"].as_u64().unwrap() as usize, accts, bs58::decode(ix["data"].as_str().unwrap()).into_vec().unwrap()));
            if let Some(groups) = tx["meta"]["innerInstructions"].as_array() {
                for g in groups.iter().filter(|g| g["index"].as_u64() == Some(i as u64)) {
                    for (k, c) in g["instructions"].as_array().unwrap().iter().enumerate() {
                        let accts = c["accounts"].as_array().unwrap().iter().map(|a| a.as_u64().unwrap() as usize).collect();
                        flat.push((format!("{i}.{k}"), c["programIdIndex"].as_u64().unwrap() as usize, accts, bs58::decode(c["data"].as_str().unwrap()).into_vec().unwrap()));
                    }
                }
            }
        }
        for (p, pidx, accts, data) in &flat {
            if keys[*pidx] != PROGRAM_ID.to_string() { continue; }
            if data.len() >= 8 && data[..8] == PREFIX {
                if let Some(e) = CpiEvent::decode(data) { if let Some((n, d)) = ev(&e) { println!("{}", json!({"signature": sig, "kind": "program_event", "source": "cpi", "name": n, "data": d, "path": p, "failed": failed})); } }
                continue;
            }
            let ix = Instruction { program_id: pk(*pidx), accounts: accts.iter().map(|a| AccountMeta::new_readonly(pk(*a), false)).collect(), data: data.clone() };
            if let Some(dec) = ProgramDecoder.decode_instruction(&ix) {
                let mut obj = match serde_json::to_value(&dec) { Ok(Value::Object(o)) => o, _ => continue };
                let name = obj.remove("type").and_then(|v| v.as_str().map(str::to_owned)).unwrap().to_snake_case();
                let d = obj.remove("data").unwrap();
                let _: &ProgramInstruction = &dec;
                println!("{}", json!({"signature": sig, "kind": "program_instruction", "name": name, "data": d, "path": p, "failed": failed}));
            }
        }
        // log events ("Program data:" while our program is on top of the stack)
        let mut stack: Vec<String> = Vec::new();
        for line in tx["meta"]["logMessages"].as_array().unwrap_or(&vec![]).iter().filter_map(|l| l.as_str()) {
            if let Some(r) = line.strip_prefix("Program ") {
                if let Some((id, rest)) = r.split_once(' ') {
                    if rest.starts_with("invoke [") { stack.push(id.to_string()); continue; }
                    if (rest == "success" || rest.starts_with("failed")) && !line.starts_with("Program log:") && !line.starts_with("Program data:") { stack.pop(); continue; }
                }
            }
            if let Some(b) = line.strip_prefix("Program data: ") {
                if stack.last().map(String::as_str) == Some(&PROGRAM_ID.to_string()) {
                    use base64::Engine as _;
                    if let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(b.trim()) {
                        let mut d = PREFIX.to_vec(); d.extend(raw);
                        if let Some(e) = CpiEvent::decode(&d) { if let Some((n, dd)) = ev(&e) { println!("{}", json!({"signature": sig, "kind": "program_event", "source": "log", "name": n, "data": dd, "failed": failed})); } }
                    }
                }
            }
        }
    }
}
