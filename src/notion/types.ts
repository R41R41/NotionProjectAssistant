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

export type PropertyType = "タイトル" | "カテゴリ" | "次のタスクにより保留中：" | "次のタスクを保留中：" | "優先度" | "工数レベル";

export interface TitleProperty {
  type: "タイトル";
  value: string;
}

export type CategoryValue = "バグ修正" | "実装" | "テスト" | "デザイン" | "マネジメント" | "マーケティング" | "その他";

export interface CategoryProperty {
  type: "カテゴリ";
  value: CategoryValue[];
}

export interface PendingByTaskProperty {
  type: "次のタスクにより保留中：";
  value: string;
}

export interface PendingTaskProperty {
  type: "次のタスクを保留中：";
  value: string;
}

export interface PriorityProperty {
  type: "優先度";
  value: "高" | "中" | "低";
}

export interface WorkloadProperty {
  type: "工数レベル";
  value: "XS(1)" | "S(2)" | "M(3)" | "L(5)" | "XL(8)";
}

export type PropertyValue = TitleProperty | CategoryProperty | PendingByTaskProperty | PendingTaskProperty | PriorityProperty | WorkloadProperty;

export interface PropertyUpdateResult {
  properties: PropertyValue[];
}


