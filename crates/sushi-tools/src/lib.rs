use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextStats {
    pub bytes: usize,
    pub chars: usize,
    pub lines: usize,
    pub words: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchLine {
    pub line_number: usize,
    pub line: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordCount {
    pub word: String,
    pub count: usize,
}

pub fn text_stats(input: &str) -> TextStats {
    TextStats {
        bytes: input.len(),
        chars: input.chars().count(),
        lines: input.lines().count(),
        words: input.split_whitespace().count(),
    }
}

pub fn find_lines(input: &str, needle: &str) -> Vec<MatchLine> {
    if needle.is_empty() {
        return Vec::new();
    }

    input
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains(needle))
        .map(|(index, line)| MatchLine {
            line_number: index + 1,
            line: line.to_owned(),
        })
        .collect()
}

pub fn top_words(input: &str, limit: usize) -> Vec<WordCount> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for word in input.split(|character: char| !character.is_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        let normalized = word.to_lowercase();
        *counts.entry(normalized).or_insert(0) += 1;
    }

    let mut words: Vec<WordCount> = counts
        .into_iter()
        .map(|(word, count)| WordCount { word, count })
        .collect();

    words.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.word.cmp(&right.word))
    });
    words.truncate(limit);
    words
}

#[cfg(test)]
mod tests {
    use super::{find_lines, text_stats, top_words};

    #[test]
    fn computes_text_stats() {
        let stats = text_stats("hello world\nsecond line\n");
        assert_eq!(stats.lines, 2);
        assert_eq!(stats.words, 4);
    }

    #[test]
    fn finds_matching_lines() {
        let matches = find_lines("alpha\nbeta\nalphabet", "alpha");
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line_number, 1);
        assert_eq!(matches[1].line_number, 3);
    }

    #[test]
    fn ranks_top_words() {
        let words = top_words("Agent agent sushi, rust rust rust", 2);
        assert_eq!(words[0].word, "rust");
        assert_eq!(words[0].count, 3);
        assert_eq!(words[1].word, "agent");
    }
}
