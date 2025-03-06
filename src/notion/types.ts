export interface BlockContent {
  blockId: string;
  content: string;
}

export interface CompletionResult {
  type: "add" | "update" | "delete";
  blockId: string;
  text: string;
}
