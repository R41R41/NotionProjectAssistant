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

export type CompletionStatus = "変更検知" | "ページ取得中" | "AI生成中" | "ページ更新中" | "完了" | "エラー";


