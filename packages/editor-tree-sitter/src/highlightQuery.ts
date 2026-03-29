export const typescriptHighlightQuery = `
(comment) @comment
(string) @string
(template_string) @string
(number) @number
(type_identifier) @type
(predefined_type) @type
(call_expression
  function: (identifier) @function)
(call_expression
  function: (member_expression
    property: (property_identifier) @function))
[
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "default"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "function"
  "if"
  "import"
  "interface"
  "implements"
  "let"
  "new"
  "return"
  "switch"
  "throw"
  "try"
  "type"
  "while"
] @keyword
[
  "+"
  "-"
  "*"
  "/"
  "="
  "=>"
  "=="
  "==="
  "!="
  "!=="
  ">"
  "<"
] @operator
[
  "."
  ","
  ";"
  ":"
  "("
  ")"
  "{"
  "}"
  "["
  "]"
] @punctuation
`;

