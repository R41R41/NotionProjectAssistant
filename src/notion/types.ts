export interface BlockContent {
  blockId: string;
  content: string;
}

export interface CompletionResult {
  type: "add" | "update" | "delete";
  blockId: string;
  text: string;
}

export interface NotionComment {
  commentId: string;
  author: string;
  content: string;
}

export type CompletionStatus = "補完開始" | "ページ取得中" | "関連情報取得中" | "AI生成中" | "ページ更新中" | "完了" | "エラー";


