use scene_lang_core::analyze_scene;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShaderCompileOutput {
    pub wgsl: String,
    pub uses_time: bool,
    pub uses_resolution: bool,
    pub uses_noise: bool,
}

pub fn compile_scene(source: &str) -> Result<ShaderCompileOutput, String> {
    let analysis = analyze_scene(source);
    let Some(program) = analysis.program else {
        let message = analysis
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity.as_str() == "error")
            .map(|diagnostic| diagnostic.message.clone())
            .unwrap_or_else(|| "WGSL source could not produce a renderable program.".to_string());
        return Err(message);
    };

    Ok(ShaderCompileOutput {
        wgsl: program.wgsl,
        uses_time: program.uses_time,
        uses_resolution: program.uses_resolution,
        uses_noise: program.uses_noise,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compile_scene_passes_wgsl_through() {
        let source = r#"struct PreviewUniforms {
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

        let output = compile_scene(source).expect("wgsl output");
        assert!(output.wgsl.contains("@vertex"));
        assert!(output.wgsl.contains("@fragment"));
        assert!(output.wgsl.contains("textureSample"));
        assert!(output.uses_time);
        assert!(output.uses_noise);
    }
}
