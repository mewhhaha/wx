struct PreviewUniforms {
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

fn sd_circle(point: vec2f, radius: f32) -> f32 {
  return length(point) - radius;
}

fn sd_box(point: vec2f, half_size: vec2f) -> f32 {
  let q = abs(point) - half_size;
  return length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0);
}

fn smooth_union(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn fill_mask(distance: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(-px, px, distance);
}

fn stroke_mask(distance: f32, width: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(width - px, width + px, abs(distance));
}

fn rotate2d(point: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(point.x * c - point.y * s, point.x * s + point.y * c);
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
  let p = vec2f(
    (uv.x * 2.0 - 1.0) * (uniforms.resolution.x / max(uniforms.resolution.y, 1.0)),
    uv.y * 2.0 - 1.0,
  );
  let px = 1.0 / max(min(uniforms.resolution.x, uniforms.resolution.y), 1.0);
  let orb = sd_circle(p - vec2f(0.24 * sin(uniforms.time), 0.0), 0.26);
  let beam = sd_box(rotate2d(p, uniforms.time * 0.5), vec2f(0.24, 0.12));
  let scene = smooth_union(orb, beam, 0.18);
  let grain = textureSample(noise_texture, noise_sampler, fract(uv * 3.0 + vec2f(uniforms.time * 0.05, 0.0))).r;
  let red = fill_mask(scene, px);
  let green = stroke_mask(orb, 0.03, px);
  let blue = 0.28 / max(abs(beam), 0.001) + 0.2 * grain;
  return vec4f(red, green, blue, 1.0);
}
