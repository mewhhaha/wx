use scene_lang_compiler::compile_scene;
use scene_lang_core::{
    SceneAnalysis, SceneDiagnostic, SceneHighlight, SceneHover, TextChange, analyze_scene,
    code_actions, format_scene, highlights_for_lines, hover_at,
};

fn escape_json(input: &str) -> String {
    let mut output = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\u{08}' => output.push_str("\\b"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{0c}' => output.push_str("\\f"),
            '\x00'..='\x1f' => output.push_str(&format!("\\u{:04x}", ch as u32)),
            _ => output.push(ch),
        }
    }
    output
}

fn diagnostic_to_json(diagnostic: &SceneDiagnostic) -> String {
    format!(
        "{{\"from\":{},\"to\":{},\"severity\":\"{}\",\"message\":\"{}\",\"source\":\"{}\",\"code\":\"{}\"}}",
        diagnostic.from,
        diagnostic.to,
        diagnostic.severity.as_str(),
        escape_json(&diagnostic.message),
        diagnostic.source,
        diagnostic.code
    )
}

fn diagnostics_json(diagnostics: &[SceneDiagnostic]) -> String {
    let body = diagnostics
        .iter()
        .map(diagnostic_to_json)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

fn highlights_json(highlights: &[SceneHighlight]) -> String {
    let body = highlights
        .iter()
        .map(|highlight| {
            format!(
                "{{\"from\":{},\"to\":{},\"role\":\"{}\"}}",
                highlight.from,
                highlight.to,
                highlight.role.as_str()
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

fn hover_json(hover: Option<SceneHover>) -> String {
    match hover {
        Some(hover) => format!(
            "{{\"content\":\"{}\",\"source\":\"{}\"}}",
            escape_json(&hover.content),
            hover.source
        ),
        None => "null".to_string(),
    }
}

fn changes_json(changes: &[TextChange]) -> String {
    let body = changes
        .iter()
        .map(|change| {
            format!(
                "{{\"from\":{},\"to\":{},\"insert\":\"{}\"}}",
                change.from,
                change.to,
                escape_json(&change.insert)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

fn code_actions_json(actions: &[scene_lang_core::CodeAction]) -> String {
    let body = actions
        .iter()
        .map(|action| {
            format!(
                "{{\"title\":\"{}\",\"changes\":{}}}",
                escape_json(&action.title),
                changes_json(&action.changes)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

pub fn diagnostics_json_payload(source: &str) -> String {
    diagnostics_json(&analyze_scene(source).diagnostics)
}

pub fn hover_json_payload(source: &str, offset: usize) -> String {
    hover_json(hover_at(source, offset))
}

pub fn format_json_payload(source: &str) -> String {
    let formatted = format_scene(source);
    let changes = if formatted == source {
        Vec::new()
    } else {
        vec![TextChange {
            from: 0,
            to: source.len(),
            insert: formatted,
        }]
    };
    changes_json(&changes)
}

pub fn code_actions_payload(source: &str, from: usize, to: usize) -> String {
    code_actions_json(&code_actions(source, from, to))
}

pub fn highlights_json_payload(source: &str, from_line: usize, to_line: usize) -> String {
    highlights_json(&highlights_for_lines(source, from_line, to_line))
}

pub fn compile_json_payload(source: &str) -> String {
    match compile_scene(source) {
        Ok(output) => format!(
            "{{\"ok\":true,\"wgsl\":\"{}\",\"usesTime\":{},\"usesResolution\":{}}}",
            escape_json(&output.wgsl),
            output.uses_time,
            output.uses_resolution
        ),
        Err(error) => format!(
            "{{\"ok\":false,\"error\":\"{}\",\"wgsl\":null,\"usesTime\":false,\"usesResolution\":false}}",
            escape_json(&error)
        ),
    }
}

#[allow(dead_code)]
pub fn diagnostics_payload(source: &str) -> String {
    diagnostics_json_payload(source)
}

#[allow(dead_code)]
pub fn hover_payload(source: &str, offset: usize) -> String {
    hover_json_payload(source, offset)
}

#[allow(dead_code)]
pub fn format_payload(source: &str) -> String {
    format_json_payload(source)
}

pub fn highlights_payload(source: &str, from_line: usize, to_line: usize) -> String {
    highlights_json_payload(source, from_line, to_line)
}

pub fn analysis(source: &str) -> SceneAnalysis {
    analyze_scene(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_payload_reports_unknown_command() {
        let source = "shader\nfragment\n  clor";
        let payload = diagnostics_json_payload(source);
        assert!(payload.contains("\"command.unknown\""));
    }

    #[test]
    fn compile_payload_contains_wgsl_when_shader_is_valid() {
        let source = r#"shader
uniform clock float builtin time

vertex
  position fullscreen

fragment
  color
    r 0.5 + 0.5 * sin(clock)
    g 0.2
    b 0.4
    a 1.0
"#;

        let payload = compile_json_payload(source);
        assert!(payload.contains("\"ok\":true"));
        assert!(payload.contains("@fragment"));
    }
}
