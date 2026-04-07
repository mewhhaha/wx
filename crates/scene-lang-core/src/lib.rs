use std::collections::HashSet;

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
    Operator,
    Punctuation,
    Text,
    Comment,
}

impl HighlightRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Keyword => "keyword",
            Self::String => "string",
            Self::Number => "number",
            Self::Type => "type",
            Self::Function => "function",
            Self::Operator => "operator",
            Self::Punctuation => "punctuation",
            Self::Text => "text",
            Self::Comment => "comment",
        }
    }
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
pub struct ShaderProgram {
    pub wgsl: String,
    pub uses_time: bool,
    pub uses_resolution: bool,
    pub uses_noise: bool,
}

#[derive(Clone, Debug)]
struct HoverEntry {
    from: usize,
    to: usize,
    content: String,
}

#[derive(Clone, Debug)]
pub struct SceneAnalysis {
    pub diagnostics: Vec<SceneDiagnostic>,
    pub highlights: Vec<SceneHighlight>,
    pub program: Option<ShaderProgram>,
    hover_entries: Vec<HoverEntry>,
}

#[derive(Clone, Debug)]
struct ParsedLine<'a> {
    trimmed: &'a str,
}

#[derive(Clone, Debug)]
struct Token {
    from: usize,
    to: usize,
    text: String,
    role: HighlightRole,
}

const KEYWORDS: &[&str] = &[
    "struct",
    "fn",
    "var",
    "let",
    "return",
    "if",
    "else",
    "for",
    "while",
    "loop",
    "break",
    "continue",
    "continuing",
    "discard",
    "const",
    "override",
    "alias",
    "enable",
    "diagnostic",
    "switch",
    "case",
    "default",
];

const ATTRIBUTES: &[&str] = &[
    "@vertex",
    "@fragment",
    "@group",
    "@binding",
    "@builtin",
    "@location",
    "@interpolate",
    "@workgroup_size",
];

const TYPES: &[&str] = &[
    "f32",
    "i32",
    "u32",
    "bool",
    "vec2f",
    "vec3f",
    "vec4f",
    "vec2i",
    "vec3i",
    "vec4i",
    "vec2u",
    "vec3u",
    "vec4u",
    "mat2x2f",
    "mat3x3f",
    "mat4x4f",
    "texture_2d",
    "sampler",
    "sampler_comparison",
    "array",
];

const BUILTIN_TOKENS: &[&str] = &[
    "sin",
    "cos",
    "tan",
    "abs",
    "floor",
    "ceil",
    "fract",
    "length",
    "min",
    "max",
    "mix",
    "clamp",
    "smoothstep",
    "normalize",
    "dot",
    "cross",
    "textureSample",
    "textureSampleLevel",
    "textureDimensions",
    "uniforms",
    "noise_texture",
    "noise_sampler",
    "vs_main",
    "fs_main",
];

pub fn analyze_scene(source: &str) -> SceneAnalysis {
    let mut diagnostics = Vec::new();
    let mut highlights = Vec::new();
    let mut hover_entries = Vec::new();

    collect_diagnostics(source, &mut diagnostics);

    for token in tokenize(source) {
        highlights.push(SceneHighlight {
            from: token.from,
            to: token.to,
            role: token.role,
        });

        if let Some(content) = hover_for_token(&token.text) {
            hover_entries.push(HoverEntry {
                from: token.from,
                to: token.to,
                content: content.to_string(),
            });
        }
    }

    let has_fatal = diagnostics.iter().any(|diagnostic| diagnostic.severity == Severity::Error);
    let program = if has_fatal {
        None
    } else {
        Some(ShaderProgram {
            wgsl: source.to_string(),
            uses_time: source.contains("uniforms.time"),
            uses_resolution: source.contains("uniforms.resolution"),
            uses_noise: source.contains("noise_texture")
                || source.contains("noise_sampler")
                || source.contains("textureSample(")
                || source.contains("textureSampleLevel("),
        })
    };

    SceneAnalysis {
        diagnostics,
        highlights,
        hover_entries,
        program,
    }
}

pub fn hover_at(source: &str, offset: usize) -> Option<SceneHover> {
    let analysis = analyze_scene(source);
    analysis
        .hover_entries
        .into_iter()
        .find(|entry| offset >= entry.from && offset < entry.to)
        .map(|entry| SceneHover {
            content: entry.content,
            source: "wgsl",
        })
}

pub fn format_scene(source: &str) -> String {
    let lines = collect_lines(source);
    let mut indent = 0usize;
    let mut output = Vec::with_capacity(lines.len());

    for line in lines {
        let trimmed = line.trimmed.trim();
        if trimmed.is_empty() {
            output.push(String::new());
            continue;
        }

        if trimmed.starts_with("//") {
            output.push(format!("{}{}", "  ".repeat(indent), trimmed));
            continue;
        }

        let starts_with_close = trimmed.starts_with('}');
        if starts_with_close {
            indent = indent.saturating_sub(1);
        }

        output.push(format!("{}{}", "  ".repeat(indent), trimmed));

        let mut opens = 0usize;
        let mut closes = 0usize;
        for ch in trimmed.chars() {
            if ch == '{' {
                opens += 1;
            } else if ch == '}' {
                closes += 1;
            }
        }
        if opens > closes {
            indent += opens - closes;
        } else {
            indent = indent.saturating_sub(closes - opens);
        }
    }

    output.join("\n")
}

pub fn code_actions(source: &str, from: usize, to: usize) -> Vec<CodeAction> {
    let tokens = tokenize(source);
    let normalized_from = from.min(source.len());
    let normalized_to = to.min(source.len());
    let suggestions = [
        "@fragment",
        "@vertex",
        "textureSample",
        "textureSampleLevel",
        "vec2f",
        "vec3f",
        "vec4f",
        "sampler",
        "texture_2d",
        "struct",
        "return",
    ];

    let mut actions = Vec::new();
    for token in tokens {
        if token.to < normalized_from || token.from > normalized_to {
            continue;
        }

        if let Some(replacement) = nearest(&token.text, &suggestions) {
            if replacement != token.text {
                actions.push(CodeAction {
                    title: format!("Replace `{}` with `{replacement}`", token.text),
                    changes: vec![TextChange {
                        from: token.from,
                        to: token.to,
                        insert: replacement.to_string(),
                    }],
                });
            }
        }
    }

    dedupe_actions(actions)
}

pub fn highlights_for_lines(source: &str, from_line: usize, to_line: usize) -> Vec<SceneHighlight> {
    let analysis = analyze_scene(source);
    let starts = line_starts(source);
    let start_offset = *starts.get(from_line).unwrap_or(&source.len());
    let end_offset = if to_line + 1 < starts.len() {
        starts[to_line + 1]
    } else {
        source.len()
    };

    analysis
        .highlights
        .into_iter()
        .filter(|span| span.to > start_offset && span.from < end_offset)
        .collect()
}

fn collect_diagnostics(source: &str, diagnostics: &mut Vec<SceneDiagnostic>) {
    if !source.contains("@vertex") {
        diagnostics.push(SceneDiagnostic {
            from: 0,
            to: 0,
            severity: Severity::Error,
            message: "WGSL preview expects an `@vertex` entrypoint.".to_string(),
            source: "wgsl",
            code: "vertex.missing",
        });
    }

    if !source.contains("@fragment") {
        diagnostics.push(SceneDiagnostic {
            from: 0,
            to: 0,
            severity: Severity::Error,
            message: "WGSL preview expects an `@fragment` entrypoint.".to_string(),
            source: "wgsl",
            code: "fragment.missing",
        });
    }

    if !source.contains("fn vs_main") {
        diagnostics.push(SceneDiagnostic {
            from: 0,
            to: 0,
            severity: Severity::Error,
            message: "WGSL preview expects a `fn vs_main` vertex entrypoint.".to_string(),
            source: "wgsl",
            code: "vertex.entry.missing",
        });
    }

    if !source.contains("fn fs_main") {
        diagnostics.push(SceneDiagnostic {
            from: 0,
            to: 0,
            severity: Severity::Error,
            message: "WGSL preview expects a `fn fs_main` fragment entrypoint.".to_string(),
            source: "wgsl",
            code: "fragment.entry.missing",
        });
    }
}

fn tokenize(source: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let chars = source.char_indices().collect::<Vec<_>>();
    let mut cursor = 0usize;

    while cursor < chars.len() {
        let (byte_index, ch) = chars[cursor];
        if ch.is_whitespace() {
            cursor += 1;
            continue;
        }

        if ch == '/' && chars.get(cursor + 1).is_some_and(|(_, next)| *next == '/') {
            let start = byte_index;
            let end = source[byte_index..]
                .find('\n')
                .map(|offset| byte_index + offset)
                .unwrap_or(source.len());
            tokens.push(Token {
                from: start,
                to: end,
                text: source[start..end].to_string(),
                role: HighlightRole::Comment,
            });
            while cursor < chars.len() && chars[cursor].1 != '\n' {
                cursor += 1;
            }
            continue;
        }

        if ch == '@' {
            let start = byte_index;
            cursor += 1;
            while cursor < chars.len() && is_identifier_continue(chars[cursor].1) {
                cursor += 1;
            }
            let end = chars.get(cursor).map(|(index, _)| *index).unwrap_or(source.len());
            let text = source[start..end].to_string();
            tokens.push(Token {
                from: start,
                to: end,
                text,
                role: HighlightRole::Keyword,
            });
            continue;
        }

        if ch.is_ascii_digit() {
            let start = byte_index;
            cursor += 1;
            while cursor < chars.len() && (chars[cursor].1.is_ascii_digit() || chars[cursor].1 == '.') {
                cursor += 1;
            }
            let end = chars.get(cursor).map(|(index, _)| *index).unwrap_or(source.len());
            tokens.push(Token {
                from: start,
                to: end,
                text: source[start..end].to_string(),
                role: HighlightRole::Number,
            });
            continue;
        }

        if is_identifier_start(ch) {
            let start = byte_index;
            cursor += 1;
            while cursor < chars.len() && is_identifier_continue(chars[cursor].1) {
                cursor += 1;
            }
            let end = chars.get(cursor).map(|(index, _)| *index).unwrap_or(source.len());
            let text = source[start..end].to_string();
            let role = classify_identifier(&text, source, end);
            tokens.push(Token {
                from: start,
                to: end,
                text,
                role,
            });
            continue;
        }

        let role = if matches!(ch, '{' | '}' | '(' | ')' | '[' | ']' | ',' | ';' | ':') {
            HighlightRole::Punctuation
        } else {
            HighlightRole::Operator
        };
        let end = byte_index + ch.len_utf8();
        tokens.push(Token {
            from: byte_index,
            to: end,
            text: source[byte_index..end].to_string(),
            role,
        });
        cursor += 1;
    }

    tokens
}

fn classify_identifier(text: &str, source: &str, end: usize) -> HighlightRole {
    if KEYWORDS.contains(&text) {
        HighlightRole::Keyword
    } else if TYPES.contains(&text) {
        HighlightRole::Type
    } else if BUILTIN_TOKENS.contains(&text) || next_non_space_char(source, end) == Some('(') {
        HighlightRole::Function
    } else {
        HighlightRole::Text
    }
}

fn next_non_space_char(source: &str, mut index: usize) -> Option<char> {
    while index < source.len() {
        let ch = source[index..].chars().next()?;
        if !ch.is_whitespace() {
            return Some(ch);
        }
        index += ch.len_utf8();
    }
    None
}

fn is_identifier_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_'
}

fn is_identifier_continue(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn hover_for_token(token: &str) -> Option<&'static str> {
    Some(match token {
        "@vertex" => "Marks the vertex entrypoint for the preview pipeline.",
        "@fragment" => "Marks the fragment entrypoint for the preview pipeline.",
        "@group" => "Declares a bind group index for a resource.",
        "@binding" => "Declares the binding slot inside a bind group.",
        "@builtin" => "Binds a function parameter or return value to a WGSL builtin.",
        "@location" => "Maps a value to a user vertex/fragment location.",
        "struct" => "Defines a WGSL struct type.",
        "fn" => "Defines a WGSL function.",
        "var" => "Declares a mutable WGSL variable or resource binding.",
        "let" => "Declares an immutable WGSL value.",
        "return" => "Returns a value from the current function.",
        "f32" | "i32" | "u32" | "bool" => "WGSL scalar type.",
        "vec2f" | "vec3f" | "vec4f" => "WGSL floating-point vector type.",
        "mat2x2f" | "mat3x3f" | "mat4x4f" => "WGSL floating-point matrix type.",
        "texture_2d" => "WGSL sampled 2D texture type.",
        "sampler" => "WGSL filtering sampler type.",
        "textureSample" => "Samples a texture with a sampler at normalized coordinates.",
        "textureSampleLevel" => "Samples a texture at an explicit mip level.",
        "uniforms" => "Preview uniform block with `time` and `resolution`.",
        "noise_texture" => "Built-in grayscale noise texture bound by the preview runtime.",
        "noise_sampler" => "Built-in repeating sampler for the noise texture.",
        "vs_main" => "The preview expects this vertex entrypoint name.",
        "fs_main" => "The preview expects this fragment entrypoint name.",
        "sin" => "Sine helper.",
        "cos" => "Cosine helper.",
        "fract" => "Returns the fractional part of a value.",
        "length" => "Returns vector length.",
        "smoothstep" => "Hermite interpolation between two thresholds.",
        "mix" => "Linear interpolation helper.",
        "clamp" => "Clamps a value into a range.",
        "min" => "Returns the smaller of two values.",
        "max" => "Returns the larger of two values.",
        _ if ATTRIBUTES.contains(&token) => "WGSL attribute.",
        _ => return None,
    })
}

fn collect_lines(source: &str) -> Vec<ParsedLine<'_>> {
    let mut lines = Vec::new();
    for raw_line in source.split('\n') {
        lines.push(ParsedLine { trimmed: raw_line });
    }
    lines
}

fn line_starts(source: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (index, byte) in source.bytes().enumerate() {
        if byte == b'\n' && index + 1 <= source.len() {
            starts.push(index + 1);
        }
    }
    starts
}

fn nearest<'a>(value: &str, candidates: &'a [&str]) -> Option<&'a str> {
    candidates
        .iter()
        .copied()
        .map(|candidate| (candidate, levenshtein(value, candidate)))
        .filter(|(_, distance)| *distance <= 3)
        .min_by_key(|(_, distance)| *distance)
        .map(|(candidate, _)| candidate)
}

fn dedupe_actions(actions: Vec<CodeAction>) -> Vec<CodeAction> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for action in actions {
        if seen.insert(action.title.clone()) {
            unique.push(action);
        }
    }

    unique
}

fn levenshtein(left: &str, right: &str) -> usize {
    if left == right {
        return 0;
    }
    if left.is_empty() {
        return right.chars().count();
    }
    if right.is_empty() {
        return left.chars().count();
    }

    let right_chars = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();

    for (row, left_char) in left.chars().enumerate() {
        let mut current = vec![row + 1];
        for (column, right_char) in right_chars.iter().enumerate() {
            let insertion = current[column] + 1;
            let deletion = previous[column + 1] + 1;
            let substitution = previous[column] + usize::from(left_char != *right_char);
            current.push(insertion.min(deletion).min(substitution));
        }
        previous = current;
    }

    *previous.last().unwrap_or(&0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"struct PreviewUniforms {
  time: f32,
  _pad0: vec3f,
  resolution: vec2f,
  _pad1: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: PreviewUniforms;
@group(0) @binding(1) var noise_texture: texture_2d<f32>;
@group(0) @binding(2) var noise_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let clip = positions[index];
  var out: VertexOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = clip * 0.5 + vec2f(0.5, 0.5);
  return out;
}

@fragment
fn fs_main(in_vertex: VertexOut) -> @location(0) vec4f {
  let uv = vec2f(in_vertex.uv.x, 1.0 - in_vertex.uv.y);
  let grain = textureSample(noise_texture, noise_sampler, fract(uv * 3.0 + vec2f(uniforms.time * 0.05, 0.0))).r;
  return vec4f(uv.x, grain, uv.y, 1.0);
}
"#;

    #[test]
    fn analysis_reports_program_for_valid_wgsl() {
        let analysis = analyze_scene(SAMPLE);
        assert!(analysis.program.is_some());
        assert!(analysis.program.as_ref().is_some_and(|program| program.uses_noise));
    }

    #[test]
    fn hover_finds_fragment_attribute() {
        let offset = SAMPLE.find("@fragment").unwrap_or(0);
        let hover = hover_at(SAMPLE, offset + 1).expect("hover");
        assert!(hover.content.contains("fragment entrypoint"));
    }

    #[test]
    fn formatter_keeps_function_names() {
        let formatted = format_scene(SAMPLE);
        assert!(formatted.contains("fn vs_main"));
        assert!(formatted.contains("fn fs_main"));
    }

    #[test]
    fn code_actions_suggest_replacing_typos() {
        let source = "textureSmple(noise_texture, noise_sampler, uv)";
        let selection = source.find("textureSmple").unwrap_or(0);
        let actions = code_actions(source, selection, selection + "textureSmple".len());
        assert!(actions.iter().any(|action| action.title.contains("textureSample")));
    }

    #[test]
    fn highlights_include_keywords_and_numbers() {
        let highlights = highlights_for_lines(SAMPLE, 0, 30);
        assert!(highlights.iter().any(|span| span.role == HighlightRole::Keyword));
        assert!(highlights.iter().any(|span| span.role == HighlightRole::Number));
    }
}
