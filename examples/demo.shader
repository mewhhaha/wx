shader
uniform clock float builtin time
sampler grain builtin noise

shape orb
  circle
  at vec2(0.24 * sin(clock), 0.0)
  radius 0.26

shape beam
  box
  size vec2(0.24, 0.12)
  rotate clock * 0.5

shape scene
  smooth orb beam 0.18

vertex
  position fullscreen

fragment
  color
    r fill scene
    g stroke orb 0.03
    b glow beam 0.28 + 0.2 * sample(grain, uv * 3.0 + vec2(clock * 0.05, 0.0))
    a 1.0
