use std::collections::{HashMap, HashSet};

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShaderType {
    Float,
    Vec2,
    Vec3,
    Vec4,
}

impl ShaderType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Float => "float",
            Self::Vec2 => "vec2",
            Self::Vec3 => "vec3",
            Self::Vec4 => "vec4",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "float" => Some(Self::Float),
            "vec2" => Some(Self::Vec2),
            "vec3" => Some(Self::Vec3),
            "vec4" => Some(Self::Vec4),
            _ => None,
        }
    }

    pub fn wgsl_name(self) -> &'static str {
        match self {
            Self::Float => "f32",
            Self::Vec2 => "vec2f",
            Self::Vec3 => "vec3f",
            Self::Vec4 => "vec4f",
        }
    }

}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuiltinUniform {
    Time,
    Resolution,
}

impl BuiltinUniform {
    fn as_str(self) -> &'static str {
        match self {
            Self::Time => "time",
            Self::Resolution => "resolution",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "time" => Some(Self::Time),
            "resolution" => Some(Self::Resolution),
            _ => None,
        }
    }

    fn expected_type(self) -> ShaderType {
        match self {
            Self::Time => ShaderType::Float,
            Self::Resolution => ShaderType::Vec2,
        }
    }

}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShaderUniform {
    pub name: String,
    pub ty: ShaderType,
    pub builtin: BuiltinUniform,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Number(String),
    Identifier(String),
    Unary {
        op: char,
        expr: Box<Expr>,
    },
    Binary {
        op: char,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Call {
        name: String,
        args: Vec<Expr>,
    },
}

#[derive(Clone, Debug)]
pub struct ShaderProgram {
    pub uniforms: Vec<ShaderUniform>,
    pub r: Expr,
    pub g: Expr,
    pub b: Expr,
    pub a: Expr,
    pub uses_time: bool,
    pub uses_resolution: bool,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TopBlock {
    None,
    Vertex,
    Fragment,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExprType {
    Scalar,
    Vec2,
    Vec3,
    Vec4,
    Invalid,
}

impl ExprType {
    fn from_shader_type(value: ShaderType) -> Self {
        match value {
            ShaderType::Float => Self::Scalar,
            ShaderType::Vec2 => Self::Vec2,
            ShaderType::Vec3 => Self::Vec3,
            ShaderType::Vec4 => Self::Vec4,
        }
    }
}

#[derive(Clone, Debug)]
struct ParsedLine<'a> {
    start: usize,
    indent: usize,
    trimmed: &'a str,
}

#[derive(Clone, Debug)]
struct AnalysisBuilder {
    diagnostics: Vec<SceneDiagnostic>,
    highlights: Vec<SceneHighlight>,
    hover_entries: Vec<HoverEntry>,
    uniforms: Vec<ShaderUniform>,
    uniform_spans: HashMap<String, (usize, usize)>,
    used_uniforms: HashSet<String>,
    has_shader_root: bool,
    has_vertex: bool,
    has_fragment: bool,
    has_fullscreen_position: bool,
    has_color_block: bool,
    channels: HashMap<char, Expr>,
}

impl AnalysisBuilder {
    fn new() -> Self {
        Self {
            diagnostics: Vec::new(),
            highlights: Vec::new(),
            hover_entries: Vec::new(),
            uniforms: Vec::new(),
            uniform_spans: HashMap::new(),
            used_uniforms: HashSet::new(),
            has_shader_root: false,
            has_vertex: false,
            has_fragment: false,
            has_fullscreen_position: false,
            has_color_block: false,
            channels: HashMap::new(),
        }
    }

    fn push_diagnostic(
        &mut self,
        from: usize,
        to: usize,
        severity: Severity,
        code: &'static str,
        message: impl Into<String>,
    ) {
        self.diagnostics.push(SceneDiagnostic {
            from,
            to,
            severity,
            message: message.into(),
            source: "shader-lang",
            code,
        });
    }

    fn push_highlight(&mut self, from: usize, to: usize, role: HighlightRole) {
        if from < to {
            self.highlights.push(SceneHighlight { from, to, role });
        }
    }

    fn push_hover(&mut self, from: usize, to: usize, content: impl Into<String>) {
        if from < to {
            self.hover_entries.push(HoverEntry {
                from,
                to,
                content: content.into(),
            });
        }
    }
}

pub fn analyze_scene(source: &str) -> SceneAnalysis {
    let parsed_lines = collect_lines(source);
    let mut builder = AnalysisBuilder::new();
    let mut block = TopBlock::None;
    let mut in_color_block = false;

    for line in &parsed_lines {
        if line.trimmed.is_empty() {
            continue;
        }

        if line.trimmed.starts_with('#') {
            builder.push_highlight(line.start + line.indent, line.start + line.trimmed.len(), HighlightRole::Comment);
            continue;
        }

        if line.indent == 0 {
            in_color_block = false;
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            let keyword_from = line.start + line.indent;
            let keyword_to = keyword_from + keyword.len();
            builder.push_highlight(keyword_from, keyword_to, HighlightRole::Keyword);
            builder.push_hover(keyword_from, keyword_to, hover_for_keyword(keyword));

            match keyword {
                "shader" => {
                    builder.has_shader_root = true;
                    block = TopBlock::None;
                }
                "uniform" => {
                    parse_uniform_line(line, &mut builder);
                    block = TopBlock::None;
                }
                "vertex" => {
                    builder.has_vertex = true;
                    block = TopBlock::Vertex;
                }
                "fragment" => {
                    builder.has_fragment = true;
                    block = TopBlock::Fragment;
                }
                _ => {
                    builder.push_diagnostic(
                        keyword_from,
                        keyword_to,
                        Severity::Error,
                        "command.unknown",
                        format!("Unknown root command `{keyword}`."),
                    );
                }
            }
            continue;
        }

        if line.indent == 2 {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            let keyword_from = line.start + line.indent;
            let keyword_to = keyword_from + keyword.len();
            builder.push_highlight(keyword_from, keyword_to, HighlightRole::Keyword);
            builder.push_hover(keyword_from, keyword_to, hover_for_keyword(keyword));

            match block {
                TopBlock::Vertex => {
                    parse_vertex_line(line, &mut builder, keyword, keyword_from, keyword_to);
                }
                TopBlock::Fragment => {
                    if keyword == "color" {
                        builder.has_color_block = true;
                        in_color_block = true;
                    } else {
                        builder.push_diagnostic(
                            keyword_from,
                            keyword_to,
                            Severity::Error,
                            "command.unknown",
                            format!("Unknown fragment command `{keyword}`."),
                        );
                        in_color_block = false;
                    }
                }
                TopBlock::None => {
                    builder.push_diagnostic(
                        keyword_from,
                        keyword_to,
                        Severity::Error,
                        "indent.unexpected",
                        "Indented command is only valid inside a vertex or fragment block.",
                    );
                }
            }
            continue;
        }

        if line.indent == 4 && block == TopBlock::Fragment && in_color_block {
            parse_channel_line(line, &mut builder);
            continue;
        }

        builder.push_diagnostic(
            line.start + line.indent,
            line.start + line.trimmed.len(),
            Severity::Error,
            "indent.unexpected",
            "This line is indented in a place the shader DSL does not understand.",
        );
    }

    if !builder.has_shader_root {
        builder.push_diagnostic(0, 0, Severity::Error, "shader.missing", "Shader file must start with a `shader` root.");
    }

    if !builder.has_vertex {
        builder.push_diagnostic(0, 0, Severity::Error, "vertex.missing", "Shader is missing a `vertex` block.");
    }

    if !builder.has_fragment {
        builder.push_diagnostic(0, 0, Severity::Error, "fragment.missing", "Shader is missing a `fragment` block.");
    }

    if builder.has_vertex && !builder.has_fullscreen_position {
        builder.push_diagnostic(
            0,
            0,
            Severity::Error,
            "vertex.position.missing",
            "Vertex block must declare `position fullscreen` in v1.",
        );
    }

    if builder.has_fragment && !builder.has_color_block {
        builder.push_diagnostic(
            0,
            0,
            Severity::Error,
            "fragment.color.missing",
            "Fragment block must declare a `color` block.",
        );
    }

    for channel in ['r', 'g', 'b', 'a'] {
        if builder.has_color_block && !builder.channels.contains_key(&channel) {
            builder.push_diagnostic(
                0,
                0,
                Severity::Error,
                "fragment.channel.missing",
                format!("Fragment color is missing the `{channel}` channel."),
            );
        }
    }

    for uniform in builder.uniforms.clone() {
        if !builder.used_uniforms.contains(&uniform.name) {
            let span = builder.uniform_spans.get(&uniform.name).copied().unwrap_or((0, 0));
            builder.push_diagnostic(
                span.0,
                span.1,
                Severity::Warning,
                "uniform.unused",
                format!("Uniform `{}` is declared but not used.", uniform.name),
            );
        }
    }

    let has_fatal = builder
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error && is_fatal_code(diagnostic.code));

    let program = if has_fatal {
        None
    } else {
        let r = builder.channels.get(&'r').cloned();
        let g = builder.channels.get(&'g').cloned();
        let b = builder.channels.get(&'b').cloned();
        let a = builder.channels.get(&'a').cloned();

        match (r, g, b, a) {
            (Some(r), Some(g), Some(b), Some(a)) => {
                let uses_time = builder.uniforms.iter().any(|uniform| {
                    uniform.builtin == BuiltinUniform::Time && builder.used_uniforms.contains(&uniform.name)
                });
                let uses_resolution = builder.uniforms.iter().any(|uniform| {
                    uniform.builtin == BuiltinUniform::Resolution && builder.used_uniforms.contains(&uniform.name)
                });

                Some(ShaderProgram {
                    uniforms: builder.uniforms.clone(),
                    r,
                    g,
                    b,
                    a,
                    uses_time,
                    uses_resolution,
                })
            }
            _ => None,
        }
    };

    SceneAnalysis {
        diagnostics: builder.diagnostics,
        highlights: builder.highlights,
        program,
        hover_entries: builder.hover_entries,
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
            source: "shader-lang",
        })
}

pub fn format_scene(source: &str) -> String {
    let lines = collect_lines(source);
    let mut block = TopBlock::None;
    let mut in_color = false;
    let mut output = Vec::with_capacity(lines.len());

    for line in lines {
        if line.trimmed.is_empty() {
            output.push(String::new());
            continue;
        }

        if line.trimmed.starts_with('#') {
            output.push(line.trimmed.to_string());
            continue;
        }

        if line.indent == 0 {
            in_color = false;
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            block = match keyword {
                "vertex" => TopBlock::Vertex,
                "fragment" => TopBlock::Fragment,
                _ => TopBlock::None,
            };
            output.push(collapse_spaces(line.trimmed));
            continue;
        }

        if line.indent == 2 {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            in_color = block == TopBlock::Fragment && keyword == "color";
            output.push(format!("  {}", collapse_spaces(line.trimmed)));
            continue;
        }

        if line.indent >= 4 && in_color {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            let rest = line.trimmed[token_end..].trim();
            if rest.is_empty() {
                output.push(format!("    {keyword}"));
            } else {
                output.push(format!("    {keyword} {}", collapse_spaces_preserving_punctuation(rest)));
            }
            continue;
        }

        output.push(collapse_spaces(line.trimmed));
    }

    output.join("\n")
}

pub fn code_actions(source: &str, from: usize, to: usize) -> Vec<CodeAction> {
    let lines = collect_lines(source);
    let mut block = TopBlock::None;
    let mut in_color = false;
    let mut actions = Vec::new();
    let normalized_from = from.min(source.len());
    let normalized_to = to.min(source.len());

    for line in lines {
        if line.trimmed.is_empty() || line.trimmed.starts_with('#') {
            continue;
        }

        let line_from = line.start + line.indent;
        let line_to = line.start + line.trimmed.len();

        if line_to < normalized_from || line_from > normalized_to {
            if line.indent == 0 {
                let token_end = first_token_end(line.trimmed);
                let keyword = &line.trimmed[..token_end];
                block = match keyword {
                    "vertex" => TopBlock::Vertex,
                    "fragment" => TopBlock::Fragment,
                    _ => TopBlock::None,
                };
                in_color = false;
            } else if line.indent == 2 {
                let token_end = first_token_end(line.trimmed);
                let keyword = &line.trimmed[..token_end];
                in_color = block == TopBlock::Fragment && keyword == "color";
            }
            continue;
        }

        if line.indent == 0 {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            let suggestions = ["shader", "uniform", "vertex", "fragment"];
            if !suggestions.contains(&keyword) {
                if let Some(replacement) = nearest(keyword, &suggestions) {
                    actions.push(replace_token_action(
                        source,
                        line.start + line.indent,
                        line.start + line.indent + keyword.len(),
                        replacement,
                    ));
                }
            }

            if keyword == "fragment" {
                actions.push(CodeAction {
                    title: "Insert default `color` block".to_string(),
                    changes: vec![TextChange {
                        from: line_to,
                        to: line_to,
                        insert: "\n  color\n    r 0.5\n    g 0.5\n    b 0.5\n    a 1.0".to_string(),
                    }],
                });
            }

            block = match keyword {
                "vertex" => TopBlock::Vertex,
                "fragment" => TopBlock::Fragment,
                _ => TopBlock::None,
            };
            in_color = false;
            continue;
        }

        if line.indent == 2 {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];

            match block {
                TopBlock::Vertex => {
                    let suggestions = ["position"];
                    if !suggestions.contains(&keyword) {
                        if let Some(replacement) = nearest(keyword, &suggestions) {
                            actions.push(replace_token_action(
                                source,
                                line.start + line.indent,
                                line.start + line.indent + keyword.len(),
                                replacement,
                            ));
                        }
                    }
                }
                TopBlock::Fragment => {
                    let suggestions = ["color"];
                    if !suggestions.contains(&keyword) {
                        if let Some(replacement) = nearest(keyword, &suggestions) {
                            actions.push(replace_token_action(
                                source,
                                line.start + line.indent,
                                line.start + line.indent + keyword.len(),
                                replacement,
                            ));
                        }
                    }
                    in_color = keyword == "color";
                }
                TopBlock::None => {}
            }
            continue;
        }

        if line.indent == 4 && in_color {
            let token_end = first_token_end(line.trimmed);
            let keyword = &line.trimmed[..token_end];
            let suggestions = ["r", "g", "b", "a"];
            if !suggestions.contains(&keyword) {
                if let Some(replacement) = nearest(keyword, &suggestions) {
                    actions.push(replace_token_action(
                        source,
                        line.start + line.indent,
                        line.start + line.indent + keyword.len(),
                        replacement,
                    ));
                }
            }
        }
    }

    dedupe_actions(actions)
}

pub fn highlights_for_lines(source: &str, from_line: usize, to_line: usize) -> Vec<SceneHighlight> {
    let analysis = analyze_scene(source);
    let line_starts = line_starts(source);
    let start_offset = *line_starts.get(from_line).unwrap_or(&source.len());
    let end_offset = if to_line + 1 < line_starts.len() {
        line_starts[to_line + 1]
    } else {
        source.len()
    };

    analysis
        .highlights
        .into_iter()
        .filter(|span| span.to > start_offset && span.from < end_offset)
        .collect()
}

fn parse_uniform_line(line: &ParsedLine<'_>, builder: &mut AnalysisBuilder) {
    let parts = split_parts_with_spans(line.trimmed);
    if parts.len() < 5 {
        builder.push_diagnostic(
            line.start + line.indent,
            line.start + line.trimmed.len(),
            Severity::Error,
            "uniform.syntax",
            "Uniform syntax is `uniform <name> <type> builtin <time|resolution>`.",
        );
        return;
    }

    let name = parts[1].0;
    let ty = parts[2].0;
    let builtin_keyword = parts[3].0;
    let builtin_value = parts[4].0;

    let name_from = line.start + line.indent + parts[1].1;
    let name_to = name_from + name.len();
    builder.push_hover(
        name_from,
        name_to,
        format!("Uniform alias for the `{builtin_value}` built-in."),
    );

    builder.push_highlight(name_from, name_to, HighlightRole::Text);

    let type_from = line.start + line.indent + parts[2].1;
    let type_to = type_from + ty.len();
    builder.push_highlight(type_from, type_to, HighlightRole::Type);
    builder.push_hover(type_from, type_to, format!("Shader type `{ty}`."));

    let builtin_keyword_from = line.start + line.indent + parts[3].1;
    let builtin_keyword_to = builtin_keyword_from + builtin_keyword.len();
    builder.push_highlight(builtin_keyword_from, builtin_keyword_to, HighlightRole::Keyword);
    builder.push_hover(
        builtin_keyword_from,
        builtin_keyword_to,
        "Declares which editor-provided uniform value this alias binds to.",
    );

    let builtin_value_from = line.start + line.indent + parts[4].1;
    let builtin_value_to = builtin_value_from + builtin_value.len();
    builder.push_highlight(builtin_value_from, builtin_value_to, HighlightRole::Keyword);
    builder.push_hover(
        builtin_value_from,
        builtin_value_to,
        hover_for_builtin(builtin_value).to_string(),
    );

    if builtin_keyword != "builtin" {
        builder.push_diagnostic(
            builtin_keyword_from,
            builtin_keyword_to,
            Severity::Error,
            "uniform.syntax",
            "Uniform declarations must use the `builtin` keyword.",
        );
    }

    if !is_valid_identifier(name) {
        builder.push_diagnostic(
            name_from,
            name_to,
            Severity::Error,
            "uniform.name.invalid",
            format!("`{name}` is not a valid uniform name."),
        );
    }

    let Some(shader_type) = ShaderType::from_str(ty) else {
        builder.push_diagnostic(
            type_from,
            type_to,
            Severity::Error,
            "type.unknown",
            format!("Unsupported shader type `{ty}`."),
        );
        return;
    };

    let Some(builtin) = BuiltinUniform::from_str(builtin_value) else {
        builder.push_diagnostic(
            builtin_value_from,
            builtin_value_to,
            Severity::Error,
            "builtin.unknown",
            format!("Unsupported built-in `{builtin_value}`."),
        );
        return;
    };

    if shader_type != builtin.expected_type() {
        builder.push_diagnostic(
            type_from,
            builtin_value_to,
            Severity::Error,
            "type.mismatch",
            format!(
                "`{}` uniforms must use `{}`.",
                builtin.as_str(),
                builtin.expected_type().as_str()
            ),
        );
        return;
    }

    if builder.uniforms.iter().any(|uniform| uniform.name == name) {
        builder.push_diagnostic(
            name_from,
            name_to,
            Severity::Error,
            "uniform.duplicate",
            format!("Uniform `{name}` is already declared."),
        );
        return;
    }

    builder.uniform_spans.insert(name.to_string(), (name_from, name_to));
    builder.uniforms.push(ShaderUniform {
        name: name.to_string(),
        ty: shader_type,
        builtin,
    });
}

fn parse_vertex_line(
    line: &ParsedLine<'_>,
    builder: &mut AnalysisBuilder,
    keyword: &str,
    keyword_from: usize,
    keyword_to: usize,
) {
    if keyword != "position" {
        builder.push_diagnostic(
            keyword_from,
            keyword_to,
            Severity::Error,
            "command.unknown",
            format!("Unknown vertex command `{keyword}`."),
        );
        return;
    }

    let rest = line.trimmed[keyword.len()..].trim();
    let rest_from = line.start + line.indent + line.trimmed.find(rest).unwrap_or(keyword.len());
    let rest_to = rest_from + rest.len();
    builder.push_highlight(rest_from, rest_to, HighlightRole::Keyword);
    builder.push_hover(rest_from, rest_to, "The v1 shader DSL only supports a fullscreen triangle vertex path.");

    if rest == "fullscreen" {
        builder.has_fullscreen_position = true;
    } else {
        builder.push_diagnostic(
            rest_from,
            rest_to,
            Severity::Error,
            "vertex.position.invalid",
            "Vertex position must be `fullscreen` in v1.",
        );
    }
}

fn parse_channel_line(line: &ParsedLine<'_>, builder: &mut AnalysisBuilder) {
    let token_end = first_token_end(line.trimmed);
    let channel = &line.trimmed[..token_end];
    let channel_from = line.start + line.indent;
    let channel_to = channel_from + channel.len();
    builder.push_highlight(channel_from, channel_to, HighlightRole::Keyword);
    builder.push_hover(channel_from, channel_to, hover_for_keyword(channel));

    if !["r", "g", "b", "a"].contains(&channel) {
        builder.push_diagnostic(
            channel_from,
            channel_to,
            Severity::Error,
            "channel.unknown",
            format!("Unknown color channel `{channel}`."),
        );
        return;
    }

    let expr_text = line.trimmed[token_end..].trim();
    if expr_text.is_empty() {
        builder.push_diagnostic(
            channel_from,
            channel_to,
            Severity::Error,
            "expr.missing",
            format!("Channel `{channel}` needs a scalar expression."),
        );
        return;
    }

    let expr_start_in_line = line.trimmed.find(expr_text).unwrap_or(token_end);
    let expr_start = line.start + line.indent + expr_start_in_line;
    let mut parser = ExpressionParser::new(expr_text, expr_start);
    let expr = parser.parse_expression();
    parser.finish(builder);

    let Some(expr) = expr else {
        return;
    };

    let symbols = builder.uniforms.clone();
    let expr_type = infer_expr_type(&expr, &symbols, builder, expr_start);
    if expr_type != ExprType::Scalar {
        builder.push_diagnostic(
            expr_start,
            expr_start + expr_text.len(),
            Severity::Error,
            "expr.type.invalid",
            format!("Channel `{channel}` must resolve to a scalar float."),
        );
        return;
    }

    builder.channels.insert(channel.chars().next().unwrap_or('r'), expr);
}

fn infer_expr_type(
    expr: &Expr,
    uniforms: &[ShaderUniform],
    builder: &mut AnalysisBuilder,
    base_offset: usize,
) -> ExprType {
    match expr {
        Expr::Number(_) => ExprType::Scalar,
        Expr::Identifier(value) => resolve_identifier_type(value, uniforms, builder),
        Expr::Unary { expr, .. } => infer_expr_type(expr, uniforms, builder, base_offset),
        Expr::Binary { left, right, .. } => {
            let left_ty = infer_expr_type(left, uniforms, builder, base_offset);
            let right_ty = infer_expr_type(right, uniforms, builder, base_offset);

            if left_ty == ExprType::Invalid || right_ty == ExprType::Invalid {
                return ExprType::Invalid;
            }

            if left_ty == right_ty {
                return left_ty;
            }

            if left_ty == ExprType::Scalar {
                return right_ty;
            }

            if right_ty == ExprType::Scalar {
                return left_ty;
            }

            builder.push_diagnostic(
                base_offset,
                base_offset + 1,
                Severity::Error,
                "expr.type.mismatch",
                "Vector operations need matching shapes or a scalar companion.",
            );
            ExprType::Invalid
        }
        Expr::Call { name, args } => infer_call_type(name, args, uniforms, builder, base_offset),
    }
}

fn resolve_identifier_type(
    value: &str,
    uniforms: &[ShaderUniform],
    builder: &mut AnalysisBuilder,
) -> ExprType {
    if value == "pi" {
        return ExprType::Scalar;
    }

    if value == "uv" {
        return ExprType::Vec2;
    }

    if let Some(field) = value.strip_prefix("uv.") {
        return if matches!(field, "x" | "y") {
            ExprType::Scalar
        } else {
            builder.push_diagnostic(0, 0, Severity::Error, "field.unknown", format!("`uv.{field}` is not supported."));
            ExprType::Invalid
        };
    }

    if let Some((name, field)) = value.split_once('.') {
        if let Some(uniform) = uniforms.iter().find(|uniform| uniform.name == name) {
            builder.used_uniforms.insert(name.to_string());
            return match (uniform.ty, field) {
                (ShaderType::Vec2, "x" | "y") => ExprType::Scalar,
                (ShaderType::Vec3, "x" | "y" | "z") => ExprType::Scalar,
                (ShaderType::Vec4, "x" | "y" | "z" | "w") => ExprType::Scalar,
                _ => {
                    builder.push_diagnostic(
                        0,
                        0,
                        Severity::Error,
                        "field.unknown",
                        format!("`{value}` is not a valid swizzle for `{}`.", uniform.ty.as_str()),
                    );
                    ExprType::Invalid
                }
            };
        }
    }

    if let Some(uniform) = uniforms.iter().find(|uniform| uniform.name == value) {
        builder.used_uniforms.insert(value.to_string());
        return ExprType::from_shader_type(uniform.ty);
    }

    builder.push_diagnostic(
        0,
        0,
        Severity::Error,
        "symbol.unknown",
        format!("Unknown shader value `{value}`."),
    );
    ExprType::Invalid
}

fn infer_call_type(
    name: &str,
    args: &[Expr],
    uniforms: &[ShaderUniform],
    builder: &mut AnalysisBuilder,
    base_offset: usize,
) -> ExprType {
    let argument_types = args
        .iter()
        .map(|arg| infer_expr_type(arg, uniforms, builder, base_offset))
        .collect::<Vec<_>>();

    match name {
        "sin" | "cos" | "abs" | "floor" | "fract" => argument_types.first().copied().unwrap_or(ExprType::Invalid),
        "length" => ExprType::Scalar,
        "min" | "max" => argument_types.first().copied().unwrap_or(ExprType::Invalid),
        "mix" | "clamp" => argument_types.first().copied().unwrap_or(ExprType::Invalid),
        "vec2" => ExprType::Vec2,
        "vec3" => ExprType::Vec3,
        "vec4" => ExprType::Vec4,
        _ => {
            builder.push_diagnostic(
                base_offset,
                base_offset + name.len(),
                Severity::Error,
                "function.unknown",
                format!("Unsupported shader helper `{name}`."),
            );
            ExprType::Invalid
        }
    }
}

fn collect_lines(source: &str) -> Vec<ParsedLine<'_>> {
    let mut lines = Vec::new();
    let mut start = 0usize;

    for raw_line in source.split('\n') {
        let indent = raw_line.chars().take_while(|ch| *ch == ' ').count();
        let trimmed = raw_line.trim_end();
        lines.push(ParsedLine { start, indent, trimmed: &trimmed[indent.min(trimmed.len())..] });
        start += raw_line.len() + 1;
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

fn first_token_end(line: &str) -> usize {
    line.find(char::is_whitespace).unwrap_or(line.len())
}

fn is_valid_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn split_parts_with_spans(input: &str) -> Vec<(&str, usize)> {
    let mut parts = Vec::new();
    let mut start = None;

    for (index, ch) in input.char_indices() {
        if ch.is_whitespace() {
            if let Some(part_start) = start.take() {
                parts.push((&input[part_start..index], part_start));
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }

    if let Some(part_start) = start {
        parts.push((&input[part_start..], part_start));
    }

    parts
}

fn hover_for_keyword(keyword: &str) -> &'static str {
    match keyword {
        "shader" => "Root shader node. Everything in the file hangs off this declaration.",
        "uniform" => "Declares a named shader input that maps to an editor-provided builtin value.",
        "vertex" => "Vertex stage block. In v1 this only supports a fullscreen triangle.",
        "fragment" => "Fragment stage block. This stage computes the final pixel color.",
        "position" => "Declares the vertex output position path.",
        "fullscreen" => "Emits a fullscreen triangle so the fragment stage can shade the whole canvas.",
        "color" => "Opens the fragment color block. Supply r, g, b, and a channel expressions below it.",
        "r" => "Red channel expression.",
        "g" => "Green channel expression.",
        "b" => "Blue channel expression.",
        "a" => "Alpha channel expression.",
        _ => "Shader DSL token.",
    }
}

fn hover_for_builtin(value: &str) -> &'static str {
    match value {
        "time" => "Animated seconds since the preview started rendering.",
        "resolution" => "Current preview canvas size as a vec2.",
        _ => "Shader builtin value.",
    }
}

fn collapse_spaces(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn collapse_spaces_preserving_punctuation(input: &str) -> String {
    let mut output = String::new();
    let mut prev_space = false;

    for ch in input.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                output.push(' ');
                prev_space = true;
            }
            continue;
        }

        if matches!(ch, ',' | ')' | '(') && output.ends_with(' ') {
            output.pop();
        }

        output.push(ch);

        if ch == ',' {
            output.push(' ');
            prev_space = true;
        } else {
            prev_space = false;
        }
    }

    output.trim().to_string()
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

fn replace_token_action(source: &str, from: usize, to: usize, replacement: &str) -> CodeAction {
    let original = source.get(from..to).unwrap_or_default();
    CodeAction {
        title: format!("Replace `{original}` with `{replacement}`"),
        changes: vec![TextChange {
            from,
            to,
            insert: replacement.to_string(),
        }],
    }
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

fn is_fatal_code(code: &str) -> bool {
    matches!(
        code,
        "shader.missing"
            | "vertex.missing"
            | "fragment.missing"
            | "vertex.position.missing"
            | "fragment.color.missing"
            | "fragment.channel.missing"
            | "expr.missing"
            | "expr.type.invalid"
            | "expr.type.mismatch"
            | "type.unknown"
            | "builtin.unknown"
            | "type.mismatch"
            | "vertex.position.invalid"
    )
}

#[derive(Clone, Debug, PartialEq)]
enum TokenKind {
    Number(String),
    Identifier(String),
    Plus,
    Minus,
    Star,
    Slash,
    LeftParen,
    RightParen,
    Comma,
}

#[derive(Clone, Debug)]
struct Token {
    kind: TokenKind,
    from: usize,
    to: usize,
}

struct ExpressionParser<'a> {
    source: &'a str,
    absolute_start: usize,
    tokens: Vec<Token>,
    cursor: usize,
    diagnostics: Vec<SceneDiagnostic>,
    highlights: Vec<SceneHighlight>,
    hovers: Vec<HoverEntry>,
}

impl<'a> ExpressionParser<'a> {
    fn new(source: &'a str, absolute_start: usize) -> Self {
        let mut parser = Self {
            source,
            absolute_start,
            tokens: Vec::new(),
            cursor: 0,
            diagnostics: Vec::new(),
            highlights: Vec::new(),
            hovers: Vec::new(),
        };
        parser.tokenize();
        parser
    }

    fn tokenize(&mut self) {
        let mut index = 0usize;
        let bytes = self.source.as_bytes();

        while index < bytes.len() {
            let ch = self.source[index..].chars().next().unwrap_or(' ');
            let width = ch.len_utf8();

            if ch.is_whitespace() {
                index += width;
                continue;
            }

            let from = self.absolute_start + index;
            match ch {
                '0'..='9' => {
                    let start = index;
                    index += width;
                    while index < bytes.len() {
                        let next = self.source[index..].chars().next().unwrap_or(' ');
                        if next.is_ascii_digit() || next == '.' {
                            index += next.len_utf8();
                        } else {
                            break;
                        }
                    }
                    let value = self.source[start..index].to_string();
                    let to = self.absolute_start + index;
                    self.highlights.push(SceneHighlight {
                        from,
                        to,
                        role: HighlightRole::Number,
                    });
                    self.tokens.push(Token {
                        kind: TokenKind::Number(value),
                        from,
                        to,
                    });
                }
                'a'..='z' | 'A'..='Z' | '_' => {
                    let start = index;
                    index += width;
                    while index < bytes.len() {
                        let next = self.source[index..].chars().next().unwrap_or(' ');
                        if next.is_ascii_alphanumeric() || matches!(next, '_' | '.') {
                            index += next.len_utf8();
                        } else {
                            break;
                        }
                    }
                    let value = self.source[start..index].to_string();
                    let to = self.absolute_start + index;
                    let role = if is_function_name(&value) {
                        HighlightRole::Function
                    } else {
                        HighlightRole::Text
                    };
                    self.highlights.push(SceneHighlight { from, to, role });
                    self.hovers.push(HoverEntry {
                        from,
                        to,
                        content: hover_for_expression_symbol(&value).to_string(),
                    });
                    self.tokens.push(Token {
                        kind: TokenKind::Identifier(value),
                        from,
                        to,
                    });
                }
                '+' => {
                    self.push_single_token(TokenKind::Plus, from, width);
                    index += width;
                }
                '-' => {
                    self.push_single_token(TokenKind::Minus, from, width);
                    index += width;
                }
                '*' => {
                    self.push_single_token(TokenKind::Star, from, width);
                    index += width;
                }
                '/' => {
                    self.push_single_token(TokenKind::Slash, from, width);
                    index += width;
                }
                '(' => {
                    self.push_single_token(TokenKind::LeftParen, from, width);
                    index += width;
                }
                ')' => {
                    self.push_single_token(TokenKind::RightParen, from, width);
                    index += width;
                }
                ',' => {
                    self.push_single_token(TokenKind::Comma, from, width);
                    index += width;
                }
                _ => {
                    self.diagnostics.push(SceneDiagnostic {
                        from,
                        to: from + width,
                        severity: Severity::Error,
                        message: format!("Unexpected character `{ch}` in shader expression."),
                        source: "shader-lang",
                        code: "expr.token.invalid",
                    });
                    index += width;
                }
            }
        }
    }

    fn push_single_token(&mut self, kind: TokenKind, from: usize, width: usize) {
        let to = from + width;
        let role = if matches!(kind, TokenKind::LeftParen | TokenKind::RightParen | TokenKind::Comma) {
            HighlightRole::Punctuation
        } else {
            HighlightRole::Operator
        };
        self.highlights.push(SceneHighlight { from, to, role });
        self.tokens.push(Token { kind, from, to });
        self.cursor = self.tokens.len().saturating_sub(1).min(self.cursor);
    }

    fn parse_expression(&mut self) -> Option<Expr> {
        self.parse_additive()
    }

    fn parse_additive(&mut self) -> Option<Expr> {
        let mut expr = self.parse_multiplicative()?;

        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Plus) => '+',
                Some(TokenKind::Minus) => '-',
                _ => break,
            };
            self.cursor += 1;
            let right = self.parse_multiplicative()?;
            expr = Expr::Binary {
                op,
                left: Box::new(expr),
                right: Box::new(right),
            };
        }

        Some(expr)
    }

    fn parse_multiplicative(&mut self) -> Option<Expr> {
        let mut expr = self.parse_unary()?;

        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Star) => '*',
                Some(TokenKind::Slash) => '/',
                _ => break,
            };
            self.cursor += 1;
            let right = self.parse_unary()?;
            expr = Expr::Binary {
                op,
                left: Box::new(expr),
                right: Box::new(right),
            };
        }

        Some(expr)
    }

    fn parse_unary(&mut self) -> Option<Expr> {
        match self.peek_kind() {
            Some(TokenKind::Plus) => {
                self.cursor += 1;
                self.parse_unary()
            }
            Some(TokenKind::Minus) => {
                self.cursor += 1;
                Some(Expr::Unary {
                    op: '-',
                    expr: Box::new(self.parse_unary()?),
                })
            }
            _ => self.parse_primary(),
        }
    }

    fn parse_primary(&mut self) -> Option<Expr> {
        let token = self.tokens.get(self.cursor)?.clone();
        self.cursor += 1;

        match token.kind {
            TokenKind::Number(value) => Some(Expr::Number(value)),
            TokenKind::Identifier(value) => {
                if matches!(self.peek_kind(), Some(TokenKind::LeftParen)) {
                    self.cursor += 1;
                    let mut args = Vec::new();

                    if !matches!(self.peek_kind(), Some(TokenKind::RightParen)) {
                        loop {
                            args.push(self.parse_expression()?);
                            if matches!(self.peek_kind(), Some(TokenKind::Comma)) {
                                self.cursor += 1;
                                continue;
                            }
                            break;
                        }
                    }

                    if !matches!(self.peek_kind(), Some(TokenKind::RightParen)) {
                        self.diagnostics.push(SceneDiagnostic {
                            from: token.from,
                            to: token.to,
                            severity: Severity::Error,
                            message: format!("Function `{value}` is missing a closing `)`."),
                            source: "shader-lang",
                            code: "expr.call.unclosed",
                        });
                        return None;
                    }

                    self.cursor += 1;
                    Some(Expr::Call { name: value, args })
                } else {
                    Some(Expr::Identifier(value))
                }
            }
            TokenKind::LeftParen => {
                let expr = self.parse_expression()?;
                if !matches!(self.peek_kind(), Some(TokenKind::RightParen)) {
                    self.diagnostics.push(SceneDiagnostic {
                        from: token.from,
                        to: token.to,
                        severity: Severity::Error,
                        message: "Expression is missing a closing `)`.".to_string(),
                        source: "shader-lang",
                        code: "expr.group.unclosed",
                    });
                    return None;
                }
                self.cursor += 1;
                Some(expr)
            }
            _ => {
                self.diagnostics.push(SceneDiagnostic {
                    from: token.from,
                    to: token.to,
                    severity: Severity::Error,
                    message: "Expected a number, name, or function call here.".to_string(),
                    source: "shader-lang",
                    code: "expr.primary.invalid",
                });
                None
            }
        }
    }

    fn peek_kind(&self) -> Option<&TokenKind> {
        self.tokens.get(self.cursor).map(|token| &token.kind)
    }

    fn finish(self, builder: &mut AnalysisBuilder) {
        builder.diagnostics.extend(self.diagnostics);
        builder.highlights.extend(self.highlights);
        builder.hover_entries.extend(self.hovers);
    }
}

fn is_function_name(value: &str) -> bool {
    matches!(
        value,
        "sin" | "cos" | "abs" | "floor" | "fract" | "length" | "min" | "max" | "mix" | "clamp" | "vec2" | "vec3" | "vec4"
    )
}

fn hover_for_expression_symbol(value: &str) -> &'static str {
    match value {
        "uv" => "Normalized fragment coordinates from 0.0 to 1.0 across the preview canvas.",
        "uv.x" => "Horizontal fragment coordinate across the preview canvas.",
        "uv.y" => "Vertical fragment coordinate across the preview canvas.",
        "pi" => "Pi as a built-in scalar constant.",
        "sin" => "Sine helper.",
        "cos" => "Cosine helper.",
        "mix" => "Linear interpolation helper.",
        "clamp" => "Clamps a value into a min/max range.",
        "vec2" => "Constructs a vec2 value.",
        "vec3" => "Constructs a vec3 value.",
        "vec4" => "Constructs a vec4 value.",
        _ => "Shader expression symbol.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"shader
uniform clock float builtin time
uniform viewport vec2 builtin resolution

vertex
  position fullscreen

fragment
  color
    r 0.5 + 0.5 * sin(clock + uv.x * 6.0)
    g 0.5 + 0.5 * sin(clock * 0.7 + uv.y * 8.0)
    b 0.35 + 0.65 * uv.x
    a 1.0
  clor
"#;

    #[test]
    fn analysis_reports_warning_and_recoverable_error() {
        let analysis = analyze_scene(SAMPLE);
        assert!(analysis.program.is_some());
        assert!(analysis.diagnostics.iter().any(|diagnostic| diagnostic.code == "uniform.unused"));
        assert!(analysis.diagnostics.iter().any(|diagnostic| diagnostic.code == "command.unknown"));
    }

    #[test]
    fn hover_finds_shader_root() {
        let offset = SAMPLE.find("shader").unwrap_or(0);
        let hover = hover_at(SAMPLE, offset + 1).expect("hover");
        assert!(hover.content.contains("Root shader node"));
    }

    #[test]
    fn formatter_normalizes_basic_spacing() {
        let formatted = format_scene("shader\nuniform clock float builtin time\nfragment\n  color\n    r 1");
        assert!(formatted.contains("uniform clock float builtin time"));
        assert!(formatted.contains("    r 1"));
    }

    #[test]
    fn code_actions_suggest_replacing_typos() {
        let selection = SAMPLE.find("clor").unwrap_or(0);
        let actions = code_actions(SAMPLE, selection, selection + 4);
        assert!(actions.iter().any(|action| action.title.contains("color")));
    }

    #[test]
    fn highlights_include_numbers_and_keywords() {
        let highlights = highlights_for_lines(SAMPLE, 0, 20);
        assert!(highlights.iter().any(|span| span.role == HighlightRole::Keyword));
        assert!(highlights.iter().any(|span| span.role == HighlightRole::Number));
    }
}
