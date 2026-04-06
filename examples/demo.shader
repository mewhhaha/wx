shader
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
  color
