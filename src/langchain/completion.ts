import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult, NotionComment } from "../notion/types.js";
import { loadPrompt, Prompts } from "../utils/loadPrompt.js";
import { z } from "zod";
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
    const prompts = ["task_completion_with_comments", "task_completion"];
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

  async generateTaskCompletionsWithComments(
    blocks: BlockContent[],
    comments: NotionComment[],
    pageTitle: string,
    categories: string[],
    status: string,
    level: string,
    subTasks: string[]
  ): Promise<CompletionResult[]> {
    try {
      const blocksContent = blocks
        .map((b) => `${b.blockId}: ${b.content}`)
        .join("\n");

      const systemContent = this.systemPrompts.get("task_completion_with_comments");
      if (!systemContent) {
        throw new Error("Failed to get task full completion prompt");
      }
      const humanContents = [
        `タスク名: ${pageTitle}`,
        `ステータス: ${status}`,
        `カテゴリ: ${categories.join(", ")}`,
        `ページ内容: ${blocksContent}`,
        `コメント: ${comments.map((c) => `${c.commentId}: ${c.content}`).join("\n")}`,
      ];

      const completions = await this.generateCompletions(
        humanContents,
        systemContent
      );
      return completions;
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }

  async generateTaskCompletions(
    blocks: BlockContent[],
    pageTitle: string,
    categories: string[],
    status: string,
    level: string,
    subTasks: string[]
  ): Promise<CompletionResult[]> {
    try {
      const systemContent = this.systemPrompts.get("task_completion");
      if (!systemContent) {
        throw new Error("Failed to get task full completion prompt");
      }

      const blocksContent = blocks
        .map((b) => `${b.blockId}: ${b.content}`)
        .join("\n");

      const humanContents = [
        `タスク名: ${pageTitle}`,
        `ステータス: ${status}`,
        `カテゴリ: ${categories.join(", ")}`,
        `ページ内容: ${blocksContent}`,
      ];

      const completions = await this.generateCompletions(
        humanContents,
        systemContent
      );
      return completions;
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }

  async generateCompletions(
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
