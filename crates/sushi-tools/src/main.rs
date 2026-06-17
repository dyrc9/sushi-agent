use std::{env, fs, process};

use sushi_tools::{find_lines, text_stats, top_words};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(usage)?;

    match command.as_str() {
        "stats" => {
            let path = args.next().ok_or_else(usage)?;
            let input = fs::read_to_string(&path).map_err(|error| format!("{path}: {error}"))?;
            let stats = text_stats(&input);
            println!("bytes\t{}", stats.bytes);
            println!("chars\t{}", stats.chars);
            println!("lines\t{}", stats.lines);
            println!("words\t{}", stats.words);
            Ok(())
        }
        "find" => {
            let path = args.next().ok_or_else(usage)?;
            let needle = args.next().ok_or_else(usage)?;
            let input = fs::read_to_string(&path).map_err(|error| format!("{path}: {error}"))?;
            for item in find_lines(&input, &needle) {
                println!("{}:{}", item.line_number, item.line);
            }
            Ok(())
        }
        "top-words" => {
            let path = args.next().ok_or_else(usage)?;
            let limit = parse_limit(args.collect::<Vec<_>>())?;
            let input = fs::read_to_string(&path).map_err(|error| format!("{path}: {error}"))?;
            for item in top_words(&input, limit) {
                println!("{}\t{}", item.word, item.count);
            }
            Ok(())
        }
        _ => Err(usage()),
    }
}

fn parse_limit(args: Vec<String>) -> Result<usize, String> {
    if args.is_empty() {
        return Ok(10);
    }
    if args.len() == 2 && args[0] == "--limit" {
        return args[1]
            .parse::<usize>()
            .map_err(|_| "Expected --limit to be a positive integer".to_owned());
    }
    Err(usage())
}

fn usage() -> String {
    "Usage: sushi-tools <stats FILE | find FILE TEXT | top-words FILE [--limit N]>".to_owned()
}
