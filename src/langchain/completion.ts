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
    const blocksContent = blocks
      .map((b) => `${b.blockId}: ${b.content}`)
      .join("\n");
    // RAGを使用して関連ドキュメントを検索
    const vectorStore = VectorStoreManager.getInstance();
    const query = `${pageTitle} ${categories.join(" ")} ${blocksContent.substring(0, 500)}`;
    const relevantDocs = await vectorStore.searchRelevantDocuments(query, 3);

    // 関連ドキュメントの内容を整形
    const contextContent = relevantDocs.map(doc => {
      return `
        タイトル: ${doc.metadata.title}
        データベース: ${doc.metadata.database === "backlog" ? "バックログ" : "資料"}
        URL: ${doc.metadata.url}
        内容:
        ${doc.pageContent.substring(0, 500)}...
        `;
    }).join("\n\n");
    return contextContent;
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
