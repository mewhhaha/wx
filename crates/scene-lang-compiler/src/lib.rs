use scene_lang_core::{BuiltinUniform, Expr, ShaderProgram, ShaderUniform, analyze_scene};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShaderCompileOutput {
    pub wgsl: String,
    pub uses_time: bool,
    pub uses_resolution: bool,
}

pub fn compile_scene(source: &str) -> Result<ShaderCompileOutput, String> {
    let analysis = analyze_scene(source);
    let Some(program) = analysis.program else {
        let message = analysis
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity.as_str() == "error")
            .map(|diagnostic| diagnostic.message.clone())
            .unwrap_or_else(|| "Shader DSL could not produce a renderable program.".to_string());
        return Err(message);
    };

    Ok(ShaderCompileOutput {
        wgsl: build_wgsl(&program),
        uses_time: program.uses_time,
        uses_resolution: program.uses_resolution,
    })
}

fn build_wgsl(program: &ShaderProgram) -> String {
    let uniform_aliases = program
        .uniforms
        .iter()
        .map(render_uniform_alias)
        .collect::<Vec<_>>()
        .join("\n  ");

    let alias_block = if uniform_aliases.is_empty() {
        String::new()
    } else {
        format!("  {uniform_aliases}\n")
    };

    format!(
        r#"struct PreviewUniforms {{
  time: f32,
  _pad0: vec3f,
  resolution: vec2f,
  _pad1: vec2f,
}}

@group(0) @binding(0) var<uniform> uniforms: PreviewUniforms;

struct VertexOut {{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {{
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
}}

@fragment
fn fs_main(in_vertex: VertexOut) -> @location(0) vec4f {{
  let uv = vec2f(in_vertex.uv.x, 1.0 - in_vertex.uv.y);
{alias_block}  return vec4f(
    {r},
    {g},
    {b},
    {a},
  );
}}
"#,
        r = render_expr(&program.r),
        g = render_expr(&program.g),
        b = render_expr(&program.b),
        a = render_expr(&program.a),
    )
}

fn render_uniform_alias(uniform: &ShaderUniform) -> String {
    format!(
        "let {}: {} = uniforms.{};",
        uniform.name,
        uniform.ty.wgsl_name(),
        match uniform.builtin {
            BuiltinUniform::Time => "time",
            BuiltinUniform::Resolution => "resolution",
        }
    )
}

fn render_expr(expr: &Expr) -> String {
    match expr {
        Expr::Number(value) => normalize_number(value),
        Expr::Identifier(value) => render_identifier(value),
        Expr::Unary { op, expr } => format!("({}{})", op, render_expr(expr)),
        Expr::Binary { op, left, right } => {
            format!("({} {} {})", render_expr(left), op, render_expr(right))
        }
        Expr::Call { name, args } => {
            let rendered_args = args.iter().map(render_expr).collect::<Vec<_>>().join(", ");
            let function_name = match name.as_str() {
                "vec2" => "vec2f",
                "vec3" => "vec3f",
                "vec4" => "vec4f",
                _ => name.as_str(),
            };
            format!("{function_name}({rendered_args})")
        }
    }
}

fn render_identifier(value: &str) -> String {
    match value {
        "pi" => "3.141592653589793".to_string(),
        other => other.to_string(),
    }
}

fn normalize_number(value: &str) -> String {
    if value.contains('.') {
        value.to_string()
    } else {
        format!("{value}.0")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compile_scene_lowers_shader_to_wgsl() {
        let source = r#"shader
uniform clock float builtin time

vertex
  position fullscreen

fragment
  color
    r 0.5 + 0.5 * sin(clock + uv.x * 6.0)
    g uv.y
    b 0.2
    a 1.0
"#;

        let output = compile_scene(source).expect("wgsl output");
        assert!(output.wgsl.contains("@vertex"));
        assert!(output.wgsl.contains("@fragment"));
        assert!(output.wgsl.contains("let clock: f32 = uniforms.time;"));
        assert!(output.wgsl.contains("sin"));
        assert!(output.uses_time);
    }
}
