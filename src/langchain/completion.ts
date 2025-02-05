import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { BlockContent, CompletionResult } from "../notion/types.js";
import { loadPrompt } from "../utils/loadPrompt.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

export class CompletionGenerator {
  private model: ChatOpenAI;
  private systemPrompt: string;
  constructor(systemPrompt: string) {
    this.model = new ChatOpenAI({
      modelName: "gpt-4o",
      temperature: 1,
      apiKey: OPENAI_API_KEY,
    });
    this.systemPrompt = systemPrompt;
  }

  public static async create(): Promise<CompletionGenerator> {
    const prompt = await loadPrompt("completion");
    if (!prompt) {
      throw new Error("Failed to load completion prompt");
    }
    return new CompletionGenerator(prompt);
  }

  async generateCompletions(
    blocks: BlockContent[]
  ): Promise<CompletionResult[]> {
    try {
      const systemContent = this.systemPrompt;
      const humanContent = blocks
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
