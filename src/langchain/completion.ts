import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult, NotionComment } from "../notion/types.js";
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
    const prompts = ["task_completion_with_comments", "task_completion", "document_completion_with_comments", "document_completion"];
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

      const completions = await this.getLLMResponse(
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

  async getLLMResponse(
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
        name: "TaskCompletion",
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
