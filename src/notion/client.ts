import { Client } from "@notionhq/client";
import { BlockContent, CompletionResult, NotionComment, CompletionStatus, PropertyValue } from "./types.js";
import { NotionPage } from "../langchain/vectorStore.js";
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

    try {
      const blocks = await this.client.blocks.children.list({
        block_id: pageId,
      });

      return blocks.results.map((block) => {
        let content = "";
        let isAI = false;

        // ブロックタイプに基づいてマークダウン形式のコンテンツを生成
        // @ts-ignore
        if (block.type === "paragraph") {
          // @ts-ignore
          const richText = block.paragraph?.rich_text?.[0];
          content = richText?.text?.content || "";
          // @ts-ignore
        } else if (block.type === "heading_1") {
          // @ts-ignore
          const richText = block.heading_1?.rich_text?.[0];
          content = `# ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "heading_2") {
          // @ts-ignore
          const richText = block.heading_2?.rich_text?.[0];
          content = `## ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "heading_3") {
          // @ts-ignore
          const richText = block.heading_3?.rich_text?.[0];
          content = `### ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "bulleted_list_item") {
          // @ts-ignore
          const richText = block.bulleted_list_item?.rich_text?.[0];
          content = `- ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "numbered_list_item") {
          // @ts-ignore
          const richText = block.numbered_list_item?.rich_text?.[0];
          content = `1. ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "to_do") {
          // @ts-ignore
          const richText = block.to_do?.rich_text?.[0];
          // @ts-ignore
          const checked = block.to_do?.checked;
          content = `- [${checked ? 'x' : ' '}] ${richText?.text?.content || ""}`;
          // @ts-ignore
        } else if (block.type === "code") {
          // @ts-ignore
          const richText = block.code?.rich_text?.[0];
          // @ts-ignore
          const language = block.code?.language || "";
          content = `\`\`\`${language}\n${richText?.text?.content || ""}\n\`\`\``;
        }

        return {
          blockId: block.id,
          content: content,
        };
      });
    } catch (error) {
      console.error(`Notionブロック取得エラー: ${error}`);
      return [];
    }
  }

  async getPageComments(pageId: string): Promise<NotionComment[]> {
    const comments = await this.client.comments.list({
      block_id: pageId,
    });

    const users = await this.client.users.list({
      page_size: 100,
    });

    return comments.results.map((comment) => {
      // ユーザー名を取得
      const user = users.results.find((user) => user.id === comment.created_by.id);
      const content = comment.rich_text.map((text) => text.plain_text).join("");

      // メンションを検出する正規表現を改善
      const mentions = content.match(/@[^\s\n]*[\p{L}\p{N}]+/gu);

      // ユーザー名が「LLMAssistant」または、メンションに含まれる場合
      const userName = user?.name || "";
      const isFeedBack = userName === "LLMAssistant" ||
        mentions?.some(mention => {
          // @を除去して比較
          const mentionName = mention.substring(1).trim();
          return userName.includes(mentionName) || mentionName.includes(userName);
        });

      if (isFeedBack) {
        return {
          commentId: comment.id,
          author: userName,
          content: content,
        };
      } else {
        return null;
      }
    }).filter((comment) => comment !== null);
  }

  async addBlock(blockId: string, text: string): Promise<void> {
    try {
      // マークダウン形式を解析してNotionのブロックタイプを決定
      const blockData = this.parseMarkdownToNotionBlock(text);
      await this.client.blocks.children.append({
        block_id: blockId,
        children: [blockData],
      });
    } catch (error: any) {
      console.error(`ブロック追加エラー: ${error}`);
      // 子ブロックをサポートしていない場合はコメントとして追加
      if (error.code === 'validation_error' && error.message.includes('Block does not support children')) {
        console.log(`ブロックが子要素をサポートしていないため、コメントとして追加します`);
        await this.addComment(blockId, text);
      } else {
        throw error;
      }
    }
  }

  async updateBlock(blockId: string, text: string): Promise<void> {
    try {
      // 1. 現在のブロックタイプを取得
      const blockResponse = await this.client.blocks.retrieve({
        block_id: blockId
      });

      // @ts-ignore
      const currentBlockType = blockResponse.type;

      if (!currentBlockType) {
        throw new Error("ブロックタイプが取得できませんでした");
      }

      // 2. マークダウン形式を解析してNotionのブロックデータに変換
      const blockData = this.parseMarkdownToNotionBlock(text);

      // 3. 現在のブロックタイプに合わせて更新
      await this.client.blocks.update({
        block_id: blockId,
        [currentBlockType]: blockData[currentBlockType]
      });
    } catch (error) {
      console.error(`ブロック更新エラー: ${error}`);
      throw error;
    }
  }

  private parseMarkdownToNotionBlock(text: string): any {
    // チェックボックス
    if (text.match(/^- \[([ x])\] /)) {
      const checked = text.includes('- [x] ');
      const content = text.replace(/^- \[([ x])\] /, '');
      return {
        type: "to_do",
        to_do: {
          rich_text: [
            {
              type: "text",
              text: { content },
            }
          ],
          checked
        }
      };
    }

    // 箇条書き
    if (text.startsWith('- ')) {
      const content = text.substring(2);
      return {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content },
            }
          ]
        }
      };
    }

    // 番号付きリスト
    if (text.match(/^\d+\. /)) {
      const content = text.replace(/^\d+\. /, '');
      return {
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content },
            }
          ]
        }
      };
    }

    // 見出し
    if (text.startsWith('# ')) {
      const content = text.substring(2);
      return {
        type: "heading_1",
        heading_1: {
          rich_text: [
            {
              type: "text",
              text: { content },
            }
          ]
        }
      };
    }

    if (text.startsWith('## ')) {
      const content = text.substring(3);
      return {
        type: "heading_2",
        heading_2: {
          rich_text: [
            {
              type: "text",
              text: { content: content },
            }
          ]
        }
      };
    }

    if (text.startsWith('### ')) {
      const content = text.substring(4);
      return {
        type: "heading_3",
        heading_3: {
          rich_text: [
            {
              type: "text",
              text: { content },
            }
          ]
        }
      };
    }

    // デフォルトは段落
    return {
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: text },
          }
        ]
      }
    };
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.client.blocks.delete({
      block_id: blockId,
    });
  }

  async addComment(blockId: string, text: string): Promise<void> {
    try {
      // ブロックの情報を取得して親ページIDを特定
      const blockResponse = await this.client.blocks.retrieve({
        block_id: blockId
      });

      // @ts-ignore
      const pageId = blockResponse.parent.page_id;

      if (!pageId) {
        throw new Error("親ページIDが取得できませんでした");
      }

      // コメントを追加
      await this.client.comments.create({
        parent: {
          page_id: pageId
        },
        rich_text: [{
          type: "text",
          text: {
            content: text
          }
        }]
      });

    } catch (error) {
      console.error(`コメント追加エラー: ${error}`);
      throw error;
    }
  }

  async updateCompletionStatus(pageId: string, status: CompletionStatus): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        "補完状態": {
          select: {
            name: status
          }
        }
      }
    });
  }

  async insertCompletion(
    completions: CompletionResult[],
    pageId: string
  ): Promise<void> {
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

    try {
      for (const completion of completions) {
        if (completion.type === "add") {
          await this.addBlock(completion.blockId, completion.text);
        } else if (completion.type === "update") {
          await this.addComment(completion.blockId, completion.text);
        } else if (completion.type === "delete") {
          await this.addComment(completion.blockId, completion.text);
        }
      }
      await this.updateCompletionStatus(pageId, "完了");
    } catch (error) {
      console.error(`全体エラー: ${error}`);
      await this.updateCompletionStatus(pageId, "エラー");
      throw error;
    }
  }

  async insertCompletionWithComments(
    completions: CompletionResult[],
    pageId: string
  ): Promise<void> {
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

    try {
      for (const completion of completions) {
        if (completion.type === "add") {
          await this.addBlock(completion.blockId, completion.text);
        } else if (completion.type === "update") {
          await this.updateBlock(completion.blockId, completion.text);
        } else if (completion.type === "delete") {
          await this.deleteBlock(completion.blockId);
        }
      }
      await this.updateCompletionStatus(pageId, "完了");
    } catch (error) {
      console.error(`全体エラー: ${error}`);
      await this.updateCompletionStatus(pageId, "エラー");
      throw error;
    }
  }

  async getAllPages(): Promise<{ backlog: any[], documents: any[] }> {
    try {
      // バックログDBのIDを環境変数から取得
      const BACKLOG_DB_ID = process.env.NOTION_BACKLOG_DB_ID;
      const DOCUMENT_DB_ID = process.env.NOTION_DOCUMENT_DB_ID;

      if (!BACKLOG_DB_ID || !DOCUMENT_DB_ID) {
        throw new Error("NOTION_BACKLOG_DB_ID or NOTION_DOCUMENT_DB_ID is not set");
      }

      // バックログDBからすべてのページを取得
      const backlogPages = await this.getAllPagesFromDatabase(BACKLOG_DB_ID);

      // 資料DBからすべてのページを取得
      const documentPages = await this.getAllPagesFromDatabase(DOCUMENT_DB_ID);

      return {
        backlog: backlogPages,
        documents: documentPages
      };
    } catch (error) {
      console.error(`Notionページ取得エラー: ${error}`);
      return { backlog: [], documents: [] };
    }
  }

  private async getAllPagesFromDatabase(databaseId: string): Promise<any[]> {
    const pages = [];
    let cursor: string | undefined = undefined;

    while (true) {
      const response = await this.client.databases.query({
        database_id: databaseId,
        start_cursor: cursor || undefined,
      });

      pages.push(...response.results);

      if (!response.has_more) break;
      cursor = response.next_cursor?.toString() || undefined;
    }

    return pages;
  }

  async getPageContent(pageId: string): Promise<string> {
    const blocks = await this.getPageBlocks(pageId);
    return blocks.map(block => block.content).join("\n");
  }

  async convertToNotionPages(pages: any[], databaseType: "backlog" | "document"): Promise<NotionPage[]> {
    const result: NotionPage[] = [];

    for (const page of pages) {
      try {
        // タイトルプロパティの名前はDBによって異なる可能性があるため調整が必要
        const titleProp = databaseType === "backlog" ? "タスク名" : "名前";
        const title = page.properties[titleProp]?.title?.[0]?.text?.content || "無題";

        // ページの内容を取得
        const content = await this.getPageContent(page.id);

        result.push({
          id: page.id,
          title,
          content,
          database: databaseType,
          categories: page.categories,
          status: page.status
        });
      } catch (error) {
        console.error(`ページ変換エラー: ${error}`);
        // エラーが発生しても処理を続行
      }
    }

    return result;
  }

  async updatePageProperties(pageId: string, properties: PropertyValue[]): Promise<void> {
    if (!pageId) {
      throw new Error("pageId must not be undefined or empty");
    }

    try {
      const notionProperties: Record<string, any> = {};

      for (const prop of properties) {
        switch (prop.type) {
          case "タイトル":
            notionProperties[prop.type] = {
              title: [
                {
                  text: {
                    content: prop.value
                  }
                }
              ]
            };
            break;
          case "カテゴリ":
            notionProperties[prop.type] = {
              multi_select: prop.value.map(value => ({ name: value }))
            };
            break;
          case "優先度":
            notionProperties[prop.type] = {
              select: {
                name: prop.value
              }
            };
            break;
          case "工数レベル":
            notionProperties[prop.type] = {
              select: {
                name: prop.value
              }
            };
            break;
          case "次のタスクにより保留中：":
            notionProperties[prop.type] = {
              relation: Array.isArray(prop.value)
                ? prop.value.map(id => ({ id }))
                : [{ id: prop.value }]
            };
            break;
          case "次のタスクを保留中：":
            notionProperties[prop.type] = {
              relation: Array.isArray(prop.value)
                ? prop.value.map(id => ({ id }))
                : [{ id: prop.value }]
            };
            break;
        }
      }

      await this.client.pages.update({
        page_id: pageId,
        properties: notionProperties
      });

      this.updateCompletionStatus(pageId, "完了");
      console.log(`\x1b[35mプロパティ更新完了: ${pageId}\x1b[0m`);
    } catch (error) {
      console.error(`プロパティ更新エラー: ${error}`);
      this.updateCompletionStatus(pageId, "エラー");
      throw error;
    }
  }
}
