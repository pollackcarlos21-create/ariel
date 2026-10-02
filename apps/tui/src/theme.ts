export function createTheme(noColor: boolean) {
  return {
    border: noColor ? undefined : "gray",
    borderStrong: noColor ? undefined : "cyan",
    accent: noColor ? undefined : "cyan",
    muted: noColor ? undefined : "gray",
    success: noColor ? undefined : "green",
    danger: noColor ? undefined : "red",
    warning: noColor ? undefined : "yellow",
    text: noColor ? undefined : "white",
    dim: !noColor,
    bold: !noColor,
  };
}

export type ArielTheme = ReturnType<typeof createTheme>;

export function terminalText(text: string): string {
  return text.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (character) =>
    character === "\n" || character === "\t"
      ? character
      : `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function terminalLabel(text: string): string {
  return terminalText(text).replaceAll("\n", "\\n").replaceAll("\t", "\\t");
}
