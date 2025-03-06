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
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

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

  async createBlock(blockId: string, text: string): Promise<void> {
    await this.client.blocks.children.append({
      block_id: blockId,
      children: [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: text } }] },
        },
      ],
    });
  }

  async updateBlock(blockId: string, text: string): Promise<void> {
    await this.client.blocks.update({
      block_id: blockId,
      paragraph: {
        rich_text: [{ text: { content: text } }],
      },
    });
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.client.blocks.delete({
      block_id: blockId,
    });
  }

  async insertCompletion(
    completions: CompletionResult[],
    pageId: string
  ): Promise<void> {
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

    for (const completion of completions) {
      if (completion.type === "add") {
        await this.createBlock(pageId, completion.text);
      } else if (completion.type === "update") {
        await this.updateBlock(completion.blockId, completion.text);
      } else if (completion.type === "delete") {
        await this.deleteBlock(completion.blockId);
      }
    }
  }

  async createInitialBlocks(pageId: string, response: string): Promise<void> {
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

    const blocks = [
      {
        object: "block" as const,
        type: "paragraph" as const,
        paragraph: {
          rich_text: [
            {
              type: "text" as const,
              text: {
                content: response,
              },
            },
          ],
        },
      },
    ];

    await this.client.blocks.children.append({
      block_id: pageId,
      children: blocks,
    });
  }
}
