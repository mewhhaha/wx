import type { HighlightRole } from "@mewhhaha/wx-language";

export function mapCaptureNameToRole(name: string): HighlightRole {
  if (name.startsWith("comment")) {
    return "comment";
  }

  if (name.startsWith("function")) {
    return "function";
  }

  if (name.startsWith("keyword")) {
    return "keyword";
  }

  if (name === "number" || name.startsWith("number.") || name === "constant.numeric") {
    return "number";
  }

  if (name.startsWith("operator")) {
    return "operator";
  }

  if (name.startsWith("punctuation")) {
    return "punctuation";
  }

  if (name.startsWith("string")) {
    return "string";
  }

  if (name.startsWith("type") || name === "constructor") {
    return "type";
  }

  return "text";
}
