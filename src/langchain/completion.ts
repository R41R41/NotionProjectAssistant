import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult, NotionComment } from "../notion/types.js";
import { PropertyValue, TitleProperty, CategoryProperty, PendingByTaskProperty, PendingTaskProperty, PriorityProperty, WorkloadProperty } from "../notion/types.js";
import { loadPrompt, Prompts } from "../utils/loadPrompt.js";
import { z } from "zod";
import { VectorStoreManager } from "./vectorStore.js";
dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

export class CompletionGenerator {
  private model: ChatOpenAI;
  private systemPrompts: Map<Prompts, string>;
  constructor(systemPrompts: Map<Prompts, string>) {
    this.model = new ChatOpenAI({
      modelName: "gpt-4o",

      temperature: 1,
      apiKey: OPENAI_API_KEY,
    });
    this.systemPrompts = systemPrompts;
  }

  public static async initialize(): Promise<CompletionGenerator> {
    const prompts = ["task_completion_with_comments", "task_completion", "document_completion_with_comments", "document_completion", "update_properties"];
    const systemPrompts = new Map<Prompts, string>();
    for (const p of prompts) {
      const prompt = await loadPrompt(p as Prompts);
      if (!prompt) {
        throw new Error("Failed to load completion prompt");
      }
      systemPrompts.set(p as Prompts, prompt);
    }

    return new CompletionGenerator(systemPrompts);
  }

  async getRelatedDocuments(pageTitle: string, categories: string[], blocks: BlockContent[]): Promise<string> {
    // ブロックの内容を結合
    const blocksContent = blocks
      .map((b) => b.content)
      .join("\n");

    // RAGを使用して関連ドキュメントを検索
    const vectorStore = VectorStoreManager.getInstance();

    // より効果的なクエリを生成
    // 1. 検索意図を明示的に含める
    // 2. 重要なキーワードを強調
    // 3. 文脈を保持しつつ、冗長な情報を削除
    const searchIntent = "以下の内容に関連する情報やタスク、ドキュメントを検索してください：";
    const keyTerms = this.extractKeyTerms(pageTitle, blocksContent);

    const query = `${searchIntent}
タイトル: ${pageTitle}
カテゴリ: ${categories.join(", ")}
重要キーワード: ${keyTerms.join(", ")}
内容概要: ${this.summarizeContent(blocksContent, 300)}`;

    console.log(`\x1b[35m検索クエリ: ${query}\x1b[0m`);

    // 検索結果の数を増やし、より多様な関連ドキュメントを取得
    const relevantDocs = await vectorStore.searchRelevantDocuments(query, 7);

    // 関連性スコアに基づいてフィルタリング（オプション）
    // const filteredDocs = relevantDocs.filter(doc => doc.metadata.score > 0.7);

    // 関連ドキュメントの内容を整形し、より詳細な情報を含める
    const contextContent = relevantDocs.map((doc, index) => {
      // ドキュメントの種類に応じて表示を変える
      const docType = doc.metadata.database === "backlog" ? "タスク" : "ドキュメント";
      const relevanceIndicator = index < 3 ? "【高関連度】" : ""; // 上位3件は高関連度としてマーク

      return `
${relevanceIndicator}${docType}: ${doc.metadata.title}
カテゴリ: ${doc.metadata.categories ? doc.metadata.categories.join(", ") : "なし"}
ステータス: ${doc.metadata.status || "不明"}
URL: ${doc.metadata.url || `https://notion.so/${doc.metadata.id}`}
内容:
${doc.pageContent.substring(0, 700)}...
`;
    }).join("\n\n");

    return contextContent || "関連情報は見つかりませんでした。";
  }

  // キーワード抽出ヘルパーメソッド
  private extractKeyTerms(title: string, content: string): string[] {
    // 日本語と英語の両方に対応したキーワード抽出

    // 1. 入力テキストの前処理
    const combinedText = `${title} ${content}`;
    // 記号や特殊文字を削除し、小文字に変換
    const cleanedText = combinedText
      .replace(/[「」『』()（）【】［］\[\]{}｛｝<>＜＞、。,.!?！？:：;；]/g, ' ')
      .toLowerCase();

    // 2. 日本語と英語の両方に対応した単語分割
    // 日本語：文字単位で区切り、2〜10文字の連続を単語候補とする
    const japaneseWords = this.extractJapaneseWords(cleanedText);
    // 英語：スペースで区切る
    const englishWords = cleanedText.split(/\s+/).filter(w => w.length >= 2);

    // 3. すべての単語候補を結合
    const allWords = [...japaneseWords, ...englishWords];

    // 4. ストップワードの除去
    const stopWords = new Set([
      'これ', 'それ', 'あれ', 'この', 'その', 'あの', 'ここ', 'そこ', 'あそこ',
      'こと', 'もの', 'ため', 'よう', 'そう', 'どう', 'ない', 'する', 'ある',
      'いる', 'なる', 'れる', 'られる', 'など', 'まで', 'から', 'として', 'について',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with',
      'by', 'about', 'as', 'of', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
      'can', 'could', 'may', 'might', 'must', 'ought'
    ]);

    const filteredWords = allWords.filter(word =>
      !stopWords.has(word) &&
      word.length >= 2 &&
      word.length <= 15 &&
      !/^\d+$/.test(word) // 数字のみの単語を除外
    );

    // 5. 単語の頻度をカウント
    const wordFrequency: Record<string, number> = {};
    filteredWords.forEach(word => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    });

    // 6. TF-IDFに似た重み付け：タイトルに含まれる単語は重要度を高くする
    const titleWords = new Set(
      [...this.extractJapaneseWords(title.toLowerCase()), ...title.toLowerCase().split(/\s+/)]
        .filter(w => w.length >= 2)
    );

    // 7. 重要度スコアの計算
    const wordScores: [string, number][] = Object.entries(wordFrequency).map(([word, freq]) => {
      // 基本スコア = 頻度
      let score = freq;

      // タイトルに含まれる単語は重要度を3倍に
      if (titleWords.has(word)) {
        score *= 3;
      }

      // 単語の長さによる重み付け（中程度の長さの単語が重要な場合が多い）
      const lengthFactor = word.length >= 3 && word.length <= 10 ? 1.5 : 1;
      score *= lengthFactor;

      return [word, score];
    });

    // 8. スコアでソートして上位15個を取得
    return wordScores
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(entry => entry[0]);
  }

  // 日本語の単語を抽出するヘルパーメソッド
  private extractJapaneseWords(text: string): string[] {
    const words: string[] = [];

    // 日本語の文字パターン（ひらがな、カタカナ、漢字）
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

    // 2〜10文字の連続した日本語文字を単語として抽出
    for (let i = 0; i < text.length; i++) {
      if (japanesePattern.test(text[i])) {
        // 2文字〜10文字の単語を抽出
        for (let len = 2; len <= 10 && i + len <= text.length; len++) {
          const word = text.substring(i, i + len);
          // すべての文字が日本語パターンに一致する場合のみ追加
          if ([...word].every(char => japanesePattern.test(char))) {
            words.push(word);
          }
        }
      }
    }

    return words;
  }

  // 内容要約ヘルパーメソッド
  private summarizeContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // 簡易的な要約（最初の部分を使用）
    // より高度な要約が必要な場合は、LLMを使った要約も検討
    const sentences = content.split(/[。.!?！？]/);
    let summary = "";

    for (const sentence of sentences) {
      if ((summary + sentence).length <= maxLength) {
        summary += sentence + "。";
      } else {
        break;
      }
    }

    return summary;
  }

  async generateCompletions(
    blocks: BlockContent[],
    comments: NotionComment[],
    pageTitle: string,
    categories: string[],
    status: string,
    contextContent: string,
    isDocument: boolean,
  ): Promise<CompletionResult[]> {
    try {
      const isComments = comments.length > 0;
      const promptType = isDocument ? "document_completion" : "task_completion";
      const promptTypeWithComments = isDocument ? "document_completion_with_comments" : "task_completion_with_comments";
      const systemContent = this.systemPrompts.get(isComments ? promptTypeWithComments : promptType);
      if (!systemContent) {
        throw new Error("Failed to get task full completion prompt");
      }

      const now = this.getTokyoDate();

      const blocksContent = blocks
        .map((b) => `${b.blockId}: ${b.content}`)
        .join("\n");

      const humanContents = [
        `現在の日時: ${now}`,
        isDocument ? `ドキュメント名: ${pageTitle}` : `タスク名: ${pageTitle}`,
        `ステータス: ${status}`,
        `カテゴリ: ${categories.join(", ")}`,
        `ページ内容: ${blocksContent}`,
        isComments ? `コメント: ${comments.map((c) => `${c.commentId}: ${c.content}`).join("\n")}` : "",
        `関連情報: ${contextContent}`,
      ];

      const completions = await this.getLLMCompletionResponse(
        humanContents,
        systemContent
      );
      return completions;
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }

  private getTokyoDate(): string {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };

    const formatter = new Intl.DateTimeFormat('ja-JP', options);
    const parts = formatter.formatToParts(new Date());

    const year = parts.find(part => part.type === 'year')?.value || '';
    const month = parts.find(part => part.type === 'month')?.value || '';
    const day = parts.find(part => part.type === 'day')?.value || '';

    return `${year}/${month}/${day}`;
  }

  // LLMから返される値を既存のPropertyValue型に変換するヘルパー関数
  private convertToPropertyValue(properties: any[]): PropertyValue[] {
    return properties.map(prop => {
      switch (prop.type) {
        case "タイトル":
          return {
            type: "タイトル",
            value: prop.value
          } as TitleProperty;

        case "カテゴリ":
          return {
            type: "カテゴリ",
            value: Array.isArray(prop.value) ? prop.value : [prop.value]
          } as CategoryProperty;

        case "次のタスクにより保留中：":
          return {
            type: "次のタスクにより保留中：",
            value: prop.value
          } as PendingByTaskProperty;

        case "次のタスクを保留中：":
          return {
            type: "次のタスクを保留中：",
            value: prop.value
          } as PendingTaskProperty;

        case "優先度":
          return {
            type: "優先度",
            value: prop.value
          } as PriorityProperty;

        case "工数レベル":
          return {
            type: "工数レベル",
            value: prop.value
          } as WorkloadProperty;

        default:
          console.warn(`未知のプロパティタイプ: ${prop.type}`);
          return null;
      }
    }).filter(Boolean) as PropertyValue[];
  }

  async generatePropertyUpdates(
    pageTitle: string,
    categories: string[],
    status: string,
    priority: string,
    workload: string,
    pendingByTask: string[],
    pendingTask: string[],
    blocks: BlockContent[],
    comments: NotionComment[],
    contextContent: string
  ): Promise<PropertyValue[]> {
    try {
      const promptType = "update_properties";
      const now = this.getTokyoDate();
      const blocksContent = blocks
        .map((b) => `${b.blockId}: ${b.content}`)
        .join("\n");
      const systemContent = this.systemPrompts.get(promptType);
      if (!systemContent) {
        throw new Error("Failed to get update properties prompt");
      }

      const humanContents = [
        `現在の日時: ${now}`,
        `タスク名: ${pageTitle}`,
        `カテゴリ: ${categories.join(", ")}`,
        `ステータス: ${status}`,
        `優先度: ${priority}`,
        `工数レベル: ${workload}`,
        `次のタスクにより保留中: ${pendingByTask.join(", ")}`,
        `次のタスクを保留中: ${pendingTask.join(", ")}`,
        `ページ内容: ${blocksContent}`,
        `関連情報: ${contextContent}`,
        `コメント: ${comments.map((c) => `${c.commentId}: ${c.content}`).join("\n")}`,
      ];

      const PropertyUpdateSchema = z.object({
        properties: z.array(z.object({
          type: z.string(),
          value: z.string(),
        }))
      });

      const structuredLLM = this.model.withStructuredOutput(PropertyUpdateSchema, {
        name: "PropertyUpdate",
      });

      const messages = [
        new SystemMessage(systemContent),
        ...humanContents.map((h) => new HumanMessage(h)),
      ];

      const response = await structuredLLM.invoke(messages);

      // LLMから返された値を既存のPropertyValue型に変換
      return this.convertToPropertyValue(response.properties);
    } catch (error) {
      console.error("プロパティ更新生成エラー:", error);
      throw error;
    }
  }

  async getLLMCompletionResponse(
    humanContents: string[],
    systemContent: string
  ): Promise<CompletionResult[]> {
    try {
      const CompletionSchema = z.object({
        completions: z.array(
          z.object({
            type: z.enum(["add", "update", "delete"]),
            blockId: z.string(),
            text: z.string(),
          })
        )
      });

      const structuredLLM = this.model.withStructuredOutput(CompletionSchema, {
        name: "Completion",
      });

      const messages = [
        new SystemMessage(systemContent),
        ...humanContents.map((h) => new HumanMessage(h)),
      ];

      const response = await structuredLLM.invoke(messages);

      // 引用符を日本語の引用符に変換
      const sanitizedCompletions = response.completions.map(completion => ({
        ...completion,
        text: completion.text
          .replace(/"/g, "'")
      }));

      return sanitizedCompletions;
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }
}
