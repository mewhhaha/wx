use std::cmp::min;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Severity {
    Error,
    Warning,
    Info,
    Hint,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Info => "info",
            Self::Hint => "hint",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HighlightRole {
    Keyword,
    String,
    Number,
    Type,
    Function,
    Text,
}

impl HighlightRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Keyword => "keyword",
            Self::String => "string",
            Self::Number => "number",
            Self::Type => "type",
            Self::Function => "function",
            Self::Text => "text",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TokenKind {
    Word,
    String,
    Number,
    Reference,
    Range,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub span: Span,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedLine {
    pub indent: usize,
    pub line_index: usize,
    pub start: usize,
    pub end: usize,
    pub raw: String,
    pub command: String,
    pub command_span: Span,
    pub tokens: Vec<Token>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Node {
    pub line: ParsedLine,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseResult {
    pub nodes: Vec<Node>,
    pub diagnostics: Vec<SceneDiagnostic>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TextChange {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeAction {
    pub title: String,
    pub changes: Vec<TextChange>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneDiagnostic {
    pub from: usize,
    pub to: usize,
    pub severity: Severity,
    pub message: String,
    pub source: &'static str,
    pub code: &'static str,
    pub replacement: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneHighlight {
    pub from: usize,
    pub to: usize,
    pub role: HighlightRole,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneHover {
    pub content: String,
    pub source: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneAnalysis {
    pub diagnostics: Vec<SceneDiagnostic>,
    pub highlights: Vec<SceneHighlight>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneProgram {
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneTextLine {
    pub number: i32,
    pub gutter: Option<i32>,
    pub text: String,
    pub eol_diagnostic: Option<(Severity, String, i32)>,
    pub below_diagnostic: Option<(Severity, String, i32)>,
}

#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct SceneStatus {
    pub left: Option<String>,
    pub file: Option<String>,
    pub right: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneCursor {
    pub kind: String,
    pub line: i32,
    pub col: i32,
}

#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct SceneRenderModel {
    pub fill_screen: bool,
    pub status: SceneStatus,
    pub lines: Vec<SceneTextLine>,
    pub cursor: Option<SceneCursor>,
}

#[derive(Clone, Copy)]
struct CommandSpec {
    name: &'static str,
    docs: &'static str,
    allowed_children: &'static [&'static str],
}

const ROOT_CHILDREN: &[&str] = &["screen"];
const SCREEN_CHILDREN: &[&str] = &[
    "size",
    "status",
    "line",
    "cursor",
    "selection",
    "row",
    "span",
    "repeat",
    "when",
    "for",
];
const STATUS_CHILDREN: &[&str] = &["left", "file", "right"];
const LINE_CHILDREN: &[&str] = &["gutter", "text", "diagnostic"];
const DIAGNOSTIC_CHILDREN: &[&str] = &["eol", "below"];
const FOR_CHILDREN: &[&str] = &[
    "row",
    "line",
    "status",
    "span",
    "text",
    "gutter",
    "diagnostic",
    "cursor",
    "selection",
];
const ROW_CHILDREN: &[&str] = &["gutter", "text", "diagnostic", "span"];

const COMMAND_SPECS: &[CommandSpec] = &[
    CommandSpec {
        name: "screen",
        docs: "Root scene node for a terminal or editor frame.",
        allowed_children: SCREEN_CHILDREN,
    },
    CommandSpec {
        name: "size",
        docs: "Declare how the scene uses the available viewport size.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "status",
        docs: "Create a status bar container.",
        allowed_children: STATUS_CHILDREN,
    },
    CommandSpec {
        name: "left",
        docs: "Render left-aligned status text.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "file",
        docs: "Render the current file segment in the status bar.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "right",
        docs: "Render right-aligned status text.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "line",
        docs: "Describe a rendered editor line in the preview.",
        allowed_children: LINE_CHILDREN,
    },
    CommandSpec {
        name: "gutter",
        docs: "Render gutter content for a line.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "text",
        docs: "Render text content for the current row.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "diagnostic",
        docs: "Attach a diagnostic with inline or end-of-line rendering.",
        allowed_children: DIAGNOSTIC_CHILDREN,
    },
    CommandSpec {
        name: "eol",
        docs: "Render a diagnostic at the end of the current line.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "below",
        docs: "Render a diagnostic beneath the current line.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "cursor",
        docs: "Render a cursor marker in the preview.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "selection",
        docs: "Describe a selected range.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "row",
        docs: "Define a reusable rendered row.",
        allowed_children: ROW_CHILDREN,
    },
    CommandSpec {
        name: "span",
        docs: "Render a styled span of text.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "repeat",
        docs: "Repeat a child scene fragment.",
        allowed_children: &[],
    },
    CommandSpec {
        name: "when",
        docs: "Conditionally render child nodes from a simple state check.",
        allowed_children: SCREEN_CHILDREN,
    },
    CommandSpec {
        name: "for",
        docs: "Iterate over a simple built-in collection such as visible-lines.",
        allowed_children: FOR_CHILDREN,
    },
];

fn command_spec(name: &str) -> Option<&'static CommandSpec> {
    COMMAND_SPECS.iter().find(|spec| spec.name == name)
}

fn known_commands() -> impl Iterator<Item = &'static str> {
    COMMAND_SPECS.iter().map(|spec| spec.name)
}

fn allowed_children(parent: Option<&str>) -> &'static [&'static str] {
    match parent {
        None => ROOT_CHILDREN,
        Some("screen") => SCREEN_CHILDREN,
        Some("status") => STATUS_CHILDREN,
        Some("line") => LINE_CHILDREN,
        Some("diagnostic") => DIAGNOSTIC_CHILDREN,
        Some("for") => FOR_CHILDREN,
        Some("row") => ROW_CHILDREN,
        _ => &[],
    }
}

fn make_span(start: usize, end: usize, line: usize, column: usize) -> Span {
    Span {
        start,
        end,
        line,
        column,
    }
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':')
}

fn tokenize_line(
    content: &str,
    absolute_start: usize,
    line_index: usize,
    indent_spaces: usize,
) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut cursor = 0usize;
    let chars: Vec<char> = content.chars().collect();

    while cursor < chars.len() {
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if cursor >= chars.len() {
            break;
        }

        let token_start = cursor;
        let token_column = indent_spaces + cursor;

        if chars[cursor] == '"' {
            cursor += 1;
            let mut value = String::new();
            while cursor < chars.len() {
                let ch = chars[cursor];
                cursor += 1;
                if ch == '"' {
                    break;
                }
                if ch == '\\' && cursor < chars.len() {
                    value.push(chars[cursor]);
                    cursor += 1;
                } else {
                    value.push(ch);
                }
            }
            let start = absolute_start + token_start;
            let end = absolute_start + cursor;
            tokens.push(Token {
                kind: TokenKind::String,
                text: value,
                span: make_span(start, end, line_index, token_column),
            });
            continue;
        }

        while cursor < chars.len() && !chars[cursor].is_whitespace() && is_word_char(chars[cursor])
        {
            cursor += 1;
        }

        if cursor == token_start {
            cursor += 1;
        }

        let text: String = chars[token_start..cursor].iter().collect();
        let kind = if text.contains("..") {
            TokenKind::Range
        } else if text.chars().all(|ch| ch.is_ascii_digit()) {
            TokenKind::Number
        } else if text.contains('.') || text == "fill" || text == "visible-lines" {
            TokenKind::Reference
        } else {
            TokenKind::Word
        };
        let start = absolute_start + token_start;
        let end = absolute_start + cursor;
        tokens.push(Token {
            kind,
            text,
            span: make_span(start, end, line_index, token_column),
        });
    }

    tokens
}

fn parse_lines(source: &str) -> (Vec<ParsedLine>, Vec<SceneDiagnostic>) {
    let mut lines = Vec::new();
    let mut diagnostics = Vec::new();
    let mut offset = 0usize;

    for (line_index, raw_line) in source.split('\n').enumerate() {
        let indent_spaces = raw_line.chars().take_while(|ch| *ch == ' ').count();
        let trimmed = raw_line[indent_spaces..].trim_end();
        let start = offset;
        let end = offset + raw_line.len();

        if trimmed.is_empty() {
            offset = end + 1;
            continue;
        }

        if indent_spaces % 2 != 0 {
            diagnostics.push(SceneDiagnostic {
                from: start,
                to: min(end, start + indent_spaces),
                severity: Severity::Error,
                message: "Indentation must use multiples of two spaces.".to_string(),
                source: "scene-lang",
                code: "indent.multiple",
                replacement: None,
            });
        }

        let tokens = tokenize_line(trimmed, start + indent_spaces, line_index, indent_spaces);
        if tokens.is_empty() {
            offset = end + 1;
            continue;
        }

        let command = tokens[0].text.clone();
        lines.push(ParsedLine {
            indent: indent_spaces / 2,
            line_index,
            start,
            end,
            raw: raw_line.to_string(),
            command_span: tokens[0].span.clone(),
            command,
            tokens,
        });

        offset = end + 1;
    }

    (lines, diagnostics)
}

fn build_nodes(
    lines: &[ParsedLine],
    index: &mut usize,
    indent: usize,
    diagnostics: &mut Vec<SceneDiagnostic>,
) -> Vec<Node> {
    let mut nodes = Vec::new();

    while *index < lines.len() {
        let line = &lines[*index];

        if line.indent < indent {
            break;
        }

        if line.indent > indent {
            diagnostics.push(SceneDiagnostic {
                from: line.start,
                to: line.end,
                severity: Severity::Error,
                message: "Unexpected indentation level.".to_string(),
                source: "scene-lang",
                code: "indent.unexpected",
                replacement: None,
            });
            *index += 1;
            continue;
        }

        let current = line.clone();
        *index += 1;
        let children = build_nodes(lines, index, indent + 1, diagnostics);
        nodes.push(Node {
            line: current,
            children,
        });
    }

    nodes
}

pub fn parse_scene(source: &str) -> ParseResult {
    let (lines, mut diagnostics) = parse_lines(source);
    let mut index = 0usize;
    let nodes = build_nodes(&lines, &mut index, 0, &mut diagnostics);
    ParseResult { nodes, diagnostics }
}

fn levenshtein(left: &str, right: &str) -> usize {
    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let mut prev: Vec<usize> = (0..=right_chars.len()).collect();
    let mut next = vec![0usize; right_chars.len() + 1];

    for (i, left_ch) in left_chars.iter().enumerate() {
        next[0] = i + 1;
        for (j, right_ch) in right_chars.iter().enumerate() {
            let cost = if left_ch == right_ch { 0 } else { 1 };
            next[j + 1] = min(min(next[j] + 1, prev[j + 1] + 1), prev[j] + cost);
        }
        prev.clone_from_slice(&next);
    }

    prev[right_chars.len()]
}

fn nearest_command(name: &str, parent: Option<&str>) -> Option<&'static str> {
    allowed_children(parent)
        .iter()
        .copied()
        .chain(known_commands())
        .min_by_key(|candidate| levenshtein(name, candidate))
}

fn push_highlights_from_line(line: &ParsedLine, highlights: &mut Vec<SceneHighlight>) {
    for (index, token) in line.tokens.iter().enumerate() {
        let role = if index == 0 {
            HighlightRole::Keyword
        } else {
            match token.kind {
                TokenKind::String => HighlightRole::String,
                TokenKind::Number | TokenKind::Range => HighlightRole::Number,
                TokenKind::Reference => HighlightRole::Type,
                TokenKind::Word => HighlightRole::Function,
            }
        };

        highlights.push(SceneHighlight {
            from: token.span.start,
            to: token.span.end,
            role,
        });
    }
}

fn validate_line(node: &Node, parent: Option<&str>, diagnostics: &mut Vec<SceneDiagnostic>) {
    let command = node.line.command.as_str();
    let allowed = allowed_children(parent);
    push_specific_diagnostics(node, diagnostics);

    if command_spec(command).is_none() {
        diagnostics.push(SceneDiagnostic {
            from: node.line.command_span.start,
            to: node.line.command_span.end,
            severity: Severity::Error,
            message: format!("Unknown command `{command}`."),
            source: "scene-lang",
            code: "command.unknown",
            replacement: nearest_command(command, parent).map(str::to_string),
        });
        return;
    }

    if !allowed.contains(&command) {
        diagnostics.push(SceneDiagnostic {
            from: node.line.command_span.start,
            to: node.line.command_span.end,
            severity: Severity::Error,
            message: match parent {
                Some(parent_name) => format!("`{command}` is not allowed inside `{parent_name}`."),
                None => format!("`{command}` is not allowed at the root level."),
            },
            source: "scene-lang",
            code: "command.illegal-child",
            replacement: None,
        });
    }
}

fn token_text<'a>(tokens: &'a [Token], index: usize) -> Option<&'a str> {
    tokens.get(index).map(|token| token.text.as_str())
}

fn push_specific_diagnostics(node: &Node, diagnostics: &mut Vec<SceneDiagnostic>) {
    let tokens = &node.line.tokens;
    let command = node.line.command.as_str();
    match command {
        "size" => {
            if token_text(tokens, 1) != Some("fill") {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Warning,
                    message: "Use `size fill` to bind the scene to the viewport.".to_string(),
                    source: "scene-lang",
                    code: "size.fill",
                    replacement: Some("size fill".to_string()),
                });
            }
        }
        "left" | "file" | "right" | "text" | "eol" | "below" => {
            if tokens.get(1).map(|token| &token.kind) != Some(&TokenKind::String) {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: format!("`{command}` expects a quoted string literal."),
                    source: "scene-lang",
                    code: "string.expected",
                    replacement: None,
                });
            }
        }
        "line" => {
            if tokens.len() < 2 {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "`line` expects a line number or reference.".to_string(),
                    source: "scene-lang",
                    code: "line.number",
                    replacement: None,
                });
            }
        }
        "gutter" => {
            if token_text(tokens, 1) != Some("number") || tokens.len() < 3 {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `gutter number <value>`.".to_string(),
                    source: "scene-lang",
                    code: "gutter.shape",
                    replacement: Some("gutter number 1".to_string()),
                });
            }
        }
        "diagnostic" => {
            let severity = token_text(tokens, 1);
            let at_keyword = token_text(tokens, 2);
            let position = token_text(tokens, 3);
            if !matches!(severity, Some("error" | "warning" | "info" | "hint"))
                || at_keyword != Some("at")
                || position.is_none()
            {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `diagnostic <severity> at <column>`.".to_string(),
                    source: "scene-lang",
                    code: "diagnostic.shape",
                    replacement: Some("diagnostic warning at 0".to_string()),
                });
            }
        }
        "cursor" => {
            let okay = matches!(token_text(tokens, 1), Some("block" | "line"))
                && token_text(tokens, 2) == Some("at")
                && token_text(tokens, 3) == Some("line")
                && token_text(tokens, 5) == Some("col");
            if !okay || tokens.len() < 7 {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `cursor <block|line> at line <n> col <n>`.".to_string(),
                    source: "scene-lang",
                    code: "cursor.shape",
                    replacement: Some("cursor block at line 1 col 0".to_string()),
                });
            }
        }
        "selection" => {
            let okay =
                token_text(tokens, 1) == Some("line") && token_text(tokens, 3) == Some("cols");
            if !okay || tokens.len() < 5 {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `selection line <n> cols <a..b>`.".to_string(),
                    source: "scene-lang",
                    code: "selection.shape",
                    replacement: Some("selection line 1 cols 0..1".to_string()),
                });
            }
        }
        "when" => {
            let okay = token_text(tokens, 1) == Some("mode")
                && token_text(tokens, 2) == Some("is")
                && tokens.len() >= 4;
            if !okay {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `when mode is <value>`.".to_string(),
                    source: "scene-lang",
                    code: "when.shape",
                    replacement: Some("when mode is insert".to_string()),
                });
            }
        }
        "for" => {
            let okay = token_text(tokens, 1) == Some("line")
                && token_text(tokens, 2) == Some("in")
                && token_text(tokens, 3) == Some("visible-lines");
            if !okay {
                diagnostics.push(SceneDiagnostic {
                    from: node.line.command_span.start,
                    to: node.line.end,
                    severity: Severity::Error,
                    message: "Use `for line in visible-lines`.".to_string(),
                    source: "scene-lang",
                    code: "for.shape",
                    replacement: Some("for line in visible-lines".to_string()),
                });
            }
        }
        _ => {}
    }
}

fn walk(
    node: &Node,
    parent: Option<&str>,
    diagnostics: &mut Vec<SceneDiagnostic>,
    highlights: &mut Vec<SceneHighlight>,
) {
    validate_line(node, parent, diagnostics);
    push_highlights_from_line(&node.line, highlights);
    for child in &node.children {
        walk(
            child,
            Some(node.line.command.as_str()),
            diagnostics,
            highlights,
        );
    }
}

pub fn analyze_scene(source: &str) -> SceneAnalysis {
    let parsed = parse_scene(source);
    let mut diagnostics = parsed.diagnostics;
    let mut highlights = Vec::new();

    for node in &parsed.nodes {
        walk(node, None, &mut diagnostics, &mut highlights);
    }

    SceneAnalysis {
        diagnostics,
        highlights,
    }
}

fn escape_string(input: &str) -> String {
    let mut output = String::with_capacity(input.len() + 4);
    for ch in input.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            _ => output.push(ch),
        }
    }
    output
}

fn format_tokens(tokens: &[Token]) -> String {
    let mut parts = Vec::with_capacity(tokens.len());
    for token in tokens {
        match token.kind {
            TokenKind::String => parts.push(format!("\"{}\"", escape_string(&token.text))),
            _ => parts.push(token.text.clone()),
        }
    }
    parts.join(" ")
}

fn write_node(node: &Node, out: &mut String) {
    out.push_str(&"  ".repeat(node.line.indent));
    out.push_str(&format_tokens(&node.line.tokens));
    out.push('\n');
    for child in &node.children {
        write_node(child, out);
    }
}

pub fn format_scene(source: &str) -> String {
    let parsed = parse_scene(source);
    let mut output = String::new();
    for node in &parsed.nodes {
        write_node(node, &mut output);
    }
    output
}

fn token_at<'a>(nodes: &'a [Node], offset: usize) -> Option<(&'a Token, &'static str)> {
    for node in nodes {
        if node.line.command_span.start <= offset && offset < node.line.command_span.end {
            if let Some(spec) = command_spec(node.line.command.as_str()) {
                return Some((&node.line.tokens[0], spec.docs));
            }
        }
        for token in node.line.tokens.iter().skip(1) {
            if token.span.start <= offset && offset < token.span.end {
                let docs = match token.text.as_str() {
                    "left" => "Left status segment.",
                    "file" => "File status segment.",
                    "right" => "Right status segment.",
                    "number" => "Number the line gutter with this value.",
                    "warning" | "error" | "info" | "hint" => "Diagnostic severity.",
                    "block" | "line" => "Cursor presentation mode.",
                    "visible-lines" => "The currently visible logical lines in the host editor.",
                    "fill" => "Fill the current scene to the viewport bounds.",
                    _ if token.kind == TokenKind::String => "String literal rendered by the scene.",
                    _ if token.kind == TokenKind::Number || token.kind == TokenKind::Range => {
                        "Numeric literal used in layout."
                    }
                    _ if token.kind == TokenKind::Reference => "Built-in scene reference.",
                    _ => continue,
                };
                return Some((token, docs));
            }
        }
        if let Some(found) = token_at(&node.children, offset) {
            return Some(found);
        }
    }
    None
}

pub fn hover_at(source: &str, offset: usize) -> Option<SceneHover> {
    let parsed = parse_scene(source);
    token_at(&parsed.nodes, offset).map(|(_, docs)| SceneHover {
        content: docs.to_string(),
        source: "scene-lang",
    })
}

fn collect_code_actions(
    node: &Node,
    selection_from: usize,
    selection_to: usize,
    out: &mut Vec<CodeAction>,
) {
    if node.line.command_span.end > selection_from && node.line.command_span.start < selection_to {
        if command_spec(node.line.command.as_str()).is_none() {
            if let Some(replacement) = nearest_command(node.line.command.as_str(), None) {
                out.push(CodeAction {
                    title: format!("Replace `{}` with `{replacement}`", node.line.command),
                    changes: vec![TextChange {
                        from: node.line.command_span.start,
                        to: node.line.command_span.end,
                        insert: replacement.to_string(),
                    }],
                });
            }
        }
    }
    for child in &node.children {
        collect_code_actions(child, selection_from, selection_to, out);
    }
}

pub fn code_actions(source: &str, selection_from: usize, selection_to: usize) -> Vec<CodeAction> {
    let parsed = parse_scene(source);
    let mut actions = Vec::new();
    for node in &parsed.nodes {
        collect_code_actions(node, selection_from, selection_to, &mut actions);
    }
    actions
}

fn parse_int_token(token: Option<&Token>) -> Option<i32> {
    token.and_then(|token| token.text.parse::<i32>().ok())
}

fn parse_string_token(token: Option<&Token>) -> Option<String> {
    token.map(|token| token.text.clone())
}

fn parse_severity(token: Option<&Token>) -> Option<Severity> {
    match token.map(|token| token.text.as_str()) {
        Some("error") => Some(Severity::Error),
        Some("warning") => Some(Severity::Warning),
        Some("info") => Some(Severity::Info),
        Some("hint") => Some(Severity::Hint),
        _ => None,
    }
}

fn build_line_model(node: &Node) -> Option<SceneTextLine> {
    let number = parse_int_token(node.line.tokens.get(1))?;
    let mut model = SceneTextLine {
        number,
        gutter: None,
        text: String::new(),
        eol_diagnostic: None,
        below_diagnostic: None,
    };

    for child in &node.children {
        match child.line.command.as_str() {
            "gutter" => model.gutter = parse_int_token(child.line.tokens.get(2)),
            "text" => model.text = parse_string_token(child.line.tokens.get(1)).unwrap_or_default(),
            "diagnostic" => {
                let severity = parse_severity(child.line.tokens.get(1));
                let at = parse_int_token(child.line.tokens.get(3)).unwrap_or_default();
                for grandchild in &child.children {
                    match grandchild.line.command.as_str() {
                        "eol" => {
                            if let (Some(severity), Some(message)) =
                                (severity, parse_string_token(grandchild.line.tokens.get(1)))
                            {
                                model.eol_diagnostic = Some((severity, message, at));
                            }
                        }
                        "below" => {
                            if let (Some(severity), Some(message)) =
                                (severity, parse_string_token(grandchild.line.tokens.get(1)))
                            {
                                model.below_diagnostic = Some((severity, message, at));
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    Some(model)
}

pub fn build_render_model(source: &str) -> SceneRenderModel {
    let parsed = parse_scene(source);
    let mut model = SceneRenderModel::default();

    for node in parsed.nodes {
        if node.line.command != "screen" {
            continue;
        }
        for child in node.children {
            match child.line.command.as_str() {
                "size" => {
                    model.fill_screen = token_text(&child.line.tokens, 1) == Some("fill");
                }
                "status" => {
                    for entry in child.children {
                        match entry.line.command.as_str() {
                            "left" => {
                                model.status.left = parse_string_token(entry.line.tokens.get(1))
                            }
                            "file" => {
                                model.status.file = parse_string_token(entry.line.tokens.get(1))
                            }
                            "right" => {
                                model.status.right = parse_string_token(entry.line.tokens.get(1))
                            }
                            _ => {}
                        }
                    }
                }
                "line" => {
                    if let Some(line) = build_line_model(&child) {
                        model.lines.push(line);
                    }
                }
                "cursor" => {
                    model.cursor = Some(SceneCursor {
                        kind: token_text(&child.line.tokens, 1)
                            .unwrap_or("block")
                            .to_string(),
                        line: parse_int_token(child.line.tokens.get(4)).unwrap_or(1),
                        col: parse_int_token(child.line.tokens.get(6)).unwrap_or_default(),
                    });
                }
                _ => {}
            }
        }
    }

    model.lines.sort_by_key(|line| line.number);
    model
}

pub fn highlights_for_lines(source: &str, from_line: usize, to_line: usize) -> Vec<SceneHighlight> {
    let analysis = analyze_scene(source);
    analysis
        .highlights
        .into_iter()
        .filter(|highlight| {
            let line = source[..min(source.len(), highlight.from)]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count();
            line >= from_line && line <= to_line
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "screen\n  size fill\n  status\n    left \" NOR \"\n    file \"demo.scene\"\n  line 10\n    gutter number 10\n    text \"return message\"\n    diagnostic error at 0\n      below \"expected number, got string\"\n";

    #[test]
    fn parses_and_formats() {
        let parsed = parse_scene(SAMPLE);
        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.nodes.len(), 1);
        assert_eq!(format_scene(SAMPLE), SAMPLE);
    }

    #[test]
    fn diagnoses_unknown_command() {
        let analysis = analyze_scene("screen\n  guttr number 1\n");
        assert!(
            analysis
                .diagnostics
                .iter()
                .any(|diag| diag.code == "command.unknown")
        );
    }

    #[test]
    fn builds_render_model() {
        let model = build_render_model(SAMPLE);
        assert!(model.fill_screen);
        assert_eq!(model.lines.len(), 1);
        assert_eq!(model.lines[0].text, "return message");
    }
}
