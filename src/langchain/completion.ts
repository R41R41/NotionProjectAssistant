import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult } from "../notion/types.js";
import { loadPrompt, Prompts } from "../utils/loadPrompt.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
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
    const prompts = ["task_full_completion", "task_partial_completion"];
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

  async generateTaskFullCompletions(
    blocks: BlockContent[],
    pageTitle: string,
    categories: string[],
    status: string
  ): Promise<CompletionResult[]> {
    try {
      const systemContent = this.systemPrompts.get("task_full_completion");
      if (!systemContent) {
        throw new Error("Failed to get task full completion prompt");
      }

      const blocksContent = blocks
        .map((b) => `${b.blockId}: ${b.content}`)
        .join("\n");

      const humanContents = [
        `タイトル: ${pageTitle}`,
        `カテゴリ: ${categories.join(", ")}`,
        `状態: ${status}`,
        `ブロック内容: ${blocksContent}`,
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
      const CompletionSchema = z.array(
        z.object({
          type: z.enum(["add", "update", "delete"]),
          blockId: z.string(),
          text: z.string(),
        })
      );

      const structuredLLM = this.model.withStructuredOutput(CompletionSchema, {
        name: "TaskCompletion",
      });

      const messages = [
        new SystemMessage(systemContent),
        ...humanContents.map((h) => new HumanMessage(h)),
      ];

      const response = await structuredLLM.invoke(messages);
      return response;
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }
}
