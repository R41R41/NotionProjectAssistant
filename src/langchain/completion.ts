import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult } from "../notion/types.js";
import { loadPrompt, Prompts } from "../utils/loadPrompt.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
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
    const prompts = ["create", "completion"];
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

  async generateCreate(
    pageTitle: string,
    categories: string[],
    status: string
  ): Promise<string> {
    try {
      const systemContent = this.systemPrompts.get("create");
      if (!systemContent) {
        throw new Error("Failed to get create prompt");
      }

      const humanContent =
        `ページのタイトル: ${pageTitle}\nカテゴリ: ${categories.join(", ")}\n状態: ${status}\n`;

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(humanContent),
      ];

      const response = await this.model.invoke(messages);

      return response.content.toString();
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }

  }


  async generateCompletions(
    blocks: BlockContent[],
    pageTitle: string,
    categories: string[],
    status: string

  ): Promise<CompletionResult[]> {
    try {
      const systemContent = this.systemPrompts.get("completion");
      if (!systemContent) {
        throw new Error("Failed to get completion prompt");
      }

      const humanContent =
        `ページのタイトル: ${pageTitle}\nカテゴリ: ${categories.join(", ")}\n状態: ${status}\n` +
        blocks
          .map((b) => `${b.blockId}: ${b.content}`)
          .join("\n");

      const parser = new JsonOutputParser();
      const chain = this.model.pipe(parser);

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(humanContent),
      ];

      const response = await chain.invoke(messages);

      return response as CompletionResult[];
    } catch (error) {
      console.error("JSONパースエラー:", error);
      throw error;
    }
  }
}
