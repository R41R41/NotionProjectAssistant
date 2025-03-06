import express from "express";
import { NotionClient } from "./notion/client.js";
import { CompletionGenerator } from "./langchain/completion.js";
import { BlockContent, NotionComment } from "./notion/types.js";
const app = express();
app.use(express.json());

const notionClient = new NotionClient();
const completionGenerator = await CompletionGenerator.initialize();

type SPANTYPE = "getBlocks" | "generate" | "insert" | "entire";

class Completion {
  pageId: string = "";
  pageTitle: string = "";
  categories: string[] = [];
  status: string = "";
  level: string = "";
  subTasks: string[] = [];
  times: { name: SPANTYPE, value: number }[] = [];
  startTime: number = 0;

  constructor(PORT: number) {
    this.initialize(PORT);
  }

  async initialize(PORT: number) {
    app.post("/task-completion", async (req, res) => {
      console.log(`\x1b[35mWebhook検知\x1b[0m`);
      res.status(200).json({ success: true });
      this.times = [];
      this.startTime = performance.now();
      const data = req.body.data;
      // console.log(`data: ${JSON.stringify(data, null, 2)}`);
      const pageId = data.id;
      const pageTitle = data.properties["タスク名"].title[0].text.content;
      const categories = data.properties["カテゴリ"].multi_select.map(
        (category: any) => category.name
      );
      const status = data.properties["ステータス"].status.name;
      const level = data.properties["工数レベル"].select?.name;
      const subTasks = data.properties["サブタスク"].relation;

      console.log(`pageTitle: ${pageTitle}`);
      console.log(`categories: ${categories}`);
      console.log(`status: ${status}`);
      console.log(`level: ${level}`);
      console.log(`subTasks: ${subTasks}`);

      const getBlocksStartTime = performance.now();
      await notionClient.updateCompletionStatus(pageId, "ページ取得中");
      const blocks = await notionClient.getPageBlocks(pageId);
      const comments = await notionClient.getPageComments(pageId);
      console.log(`\x1b[35mブロック取得完了\x1b[0m`);
      const getBlocksEndTime = performance.now();
      // console.log(JSON.stringify(blocks, null, 2));
      console.log(JSON.stringify(comments, null, 2));
      this.times.push({ name: "getBlocks", value: getBlocksEndTime - getBlocksStartTime });
      if (comments.length > 0) {
        await this.generateCompletionsWithComments(blocks, comments, pageId, pageTitle, categories, status, level, subTasks);
      } else {
        await this.generateCompletions(blocks, pageId, pageTitle, categories, status, level, subTasks);
      }
    });
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  }

  async generateCompletionsWithComments(blocks: BlockContent[], comments: NotionComment[], pageId: string, pageTitle: string, categories: string[], status: string, level: string, subTasks: string[]) {
    try {
      const generateStartTime = performance.now();
      await notionClient.updateCompletionStatus(pageId, "AI生成中");
      const completions = await completionGenerator.generateTaskCompletionsWithComments(
        blocks,
        comments,
        pageTitle,
        categories,
        status,
        level,
        subTasks
      );
      console.log(`\x1b[35mAI生成完了\x1b[0m`);
      const generateEndTime = performance.now();
      this.times.push({ name: "generate", value: generateEndTime - generateStartTime });
      console.log(JSON.stringify(completions, null, 2));
      const insertStartTime = performance.now();
      await notionClient.updateCompletionStatus(pageId, "ページ更新中");
      await notionClient.insertCompletionWithComments(completions, pageId);
      const insertEndTime = performance.now();
      console.log(`\x1b[35mフィードバック挿入完了\x1b[0m`);
      this.times.push({ name: "insert", value: insertEndTime - insertStartTime });
      const endTime = performance.now();
      this.times.push({ name: "entire", value: endTime - this.startTime });
      this.printTimes();
    } catch (error) {
      const endTime = performance.now();
      console.error(error);
      this.times.push({ name: "entire", value: endTime - this.startTime });
      this.printTimes();
    }
  }

  async generateCompletions(blocks: BlockContent[], pageId: string, pageTitle: string, categories: string[], status: string, level: string, subTasks: string[]) {
    try {
      const generateStartTime = performance.now();
      await notionClient.updateCompletionStatus(pageId, "AI生成中");
      const completions = await completionGenerator.generateTaskCompletions(
        blocks,
        pageTitle,
        categories,
        status,
        level,
        subTasks
      );
      console.log(`\x1b[35mAI生成完了\x1b[0m`);
      const generateEndTime = performance.now();
      this.times.push({ name: "generate", value: generateEndTime - generateStartTime });
      console.log(JSON.stringify(completions, null, 2));
      const insertStartTime = performance.now();
      await notionClient.updateCompletionStatus(pageId, "ページ更新中");
      await notionClient.insertCompletion(completions, pageId);
      const insertEndTime = performance.now();
      console.log(`\x1b[35mフィードバック挿入完了\x1b[0m`);
      this.times.push({ name: "insert", value: insertEndTime - insertStartTime });
      const endTime = performance.now();
      this.times.push({ name: "entire", value: endTime - this.startTime });
      this.printTimes();
    } catch (error) {
      const endTime = performance.now();
      console.error(error);
      this.times.push({ name: "entire", value: endTime - this.startTime });
      this.printTimes();
    }
  }

  async printTimes() {
    console.log(
      `\x1b[35mブロック取得: ${((this.times.find(t => t.name === "getBlocks")?.value ?? 0) / 1000).toFixed(2)}秒\x1b[0m`
    );
    console.log(
      `\x1b[35mAI生成: ${((this.times.find(t => t.name === "generate")?.value ?? 0) / 1000).toFixed(2)}秒\x1b[0m`
    );
    console.log(
      `\x1b[35mフィードバック挿入: ${((this.times.find(t => t.name === "insert")?.value ?? 0) / 1000).toFixed(2)}秒\x1b[0m`
    );
    console.log(
      `\x1b[35m総実行時間: ${((this.times.find(t => t.name === "entire")?.value ?? 0) / 1000).toFixed(2)}秒\x1b[0m`
    );
  }
}

const PORT = process.env.PORT || 3001;

new Completion(Number(PORT));
