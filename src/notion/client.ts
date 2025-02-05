import { Client } from "@notionhq/client";
import { BlockContent, CompletionResult } from "./types.js";
import dotenv from "dotenv";

dotenv.config();
const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
  throw new Error("NOTION_API_KEY is not set");
}

export class NotionClient {
  private client: Client;

  constructor() {
    this.client = new Client({ auth: NOTION_API_KEY });
  }

  async getPageBlocks(pageId: string): Promise<BlockContent[]> {
    const blocks = await this.client.blocks.children.list({
      block_id: pageId,
    });

    return blocks.results.map((block) => {
      // @ts-ignore
      const content = block.paragraph?.rich_text?.[0]?.text?.content || "";
      return {
        blockId: block.id,
        content: content,
      };
    });
  }

  async insertCompletion(completions: CompletionResult[]): Promise<void> {
    for (const completion of completions) {
      await this.client.blocks.children.append({
        block_id: completion.blockId,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: completion.completionText,
                  },
                },
              ],
            },
          },
        ],
      });
    }
  }
}
