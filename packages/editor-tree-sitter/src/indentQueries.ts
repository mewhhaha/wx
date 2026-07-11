/** Conservative TypeScript query for wx-indent-v1. Consumers may replace it per grammar. */
export const typescriptIndentQuery = `
  (statement_block) @indent
  (object) @indent
  (array) @indent
  (statement_block "}" @outdent)
  (object "}" @outdent)
  (array "]" @outdent)
  (formal_parameters "(" @anchor) @align
  (formal_parameters ")" @outdent)
  (arguments "(" @anchor) @align
  (arguments ")" @outdent)
  (template_string) @opaque
  (comment) @opaque
`;

/** Scene/WGSL fixtures exercise the generic capture model; no WGSL grammar ships here. */
export const sceneIndentQuery = `
  (compound) @indent
  (compound "}" @outdent)
  (struct) @indent
  (struct "}" @outdent)
`;
