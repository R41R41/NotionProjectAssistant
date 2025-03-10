import express from "express";
import { NotionClient } from "./notion/client.js";
import { CompletionGenerator } from "./langchain/completion.js";
import { BlockContent, NotionComment, CompletionResult } from "./notion/types.js";
import { VectorStoreManager } from "./langchain/vectorStore.js";
const app = express();
app.use(express.json());

type SPANTYPE = "getBlocks" | "getRelatedDocuments" | "generate" | "insert" | "entire";

class Completion {
  pageId: string = "";
  pageTitle: string = "";
  categories: string[] = [];
  status: string = "";
  level: string = "";
  subTasks: string[] = [];
  times: { name: SPANTYPE, value: number }[] = [];
  startTime: number = 0;

  // クラスプロパティとして定義し、初期化
  private notionClient: NotionClient = new NotionClient();
  private completionGenerator!: CompletionGenerator; // 非同期初期化のため!を使用

  constructor(PORT: number) {
    this.initialize(PORT);
  }

  async initialize(PORT: number) {
    console.log(`\x1b[35m${PORT}番ポートで起動中\x1b[0m`);

    // NotionClientとCompletionGeneratorのインスタンスを作成
    this.notionClient = new NotionClient();
    this.completionGenerator = await CompletionGenerator.initialize();

    // サーバー起動時にNotionのすべてのページを取得
    try {
      console.log(`\x1b[35mNotionページの取得を開始します...\x1b[0m`);
      const allPages = await this.notionClient.getAllPages();
      console.log(`\x1b[35mバックログDB: ${allPages.backlog.length}ページ, 資料DB: ${allPages.documents.length}ページ取得完了\x1b[0m`);

      // ページの内容を取得してNotionPageオブジェクトに変換
      const backlogPages = await this.notionClient.convertToNotionPages(allPages.backlog, "backlog");
      const documentPages = await this.notionClient.convertToNotionPages(allPages.documents, "document");
      const allNotionPages = [...backlogPages, ...documentPages];

      // ベクトルストアを初期化
      const vectorStore = VectorStoreManager.getInstance();
      await vectorStore.initialize(allNotionPages);
      console.log(`\x1b[35mベクトルストア初期化完了\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[31mNotionページ取得エラー: ${error}\x1b[0m`);
    }

    // デバッグ用のルートエンドポイント
    app.get("/", (req, res) => {
      console.log(`\x1b[35mルートエンドポイントにアクセスがありました\x1b[0m`);
      res.status(200).send("Notion Project Assistant サーバーが稼働中です");
    });

    // task-completionエンドポイントの設定
    app.post("/task-completion", async (req, res) => {
      console.log(`\x1b[35mWebhook検知: /task-completion\x1b[0m`);
      // レスポンスを即時返す
      res.status(200).json({ success: true, message: "Webhook received" });

      // 以降の処理を実行
      try {
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

        console.log(`pageTitle: ${pageTitle}`);
        console.log(`categories: ${categories}`);
        console.log(`status: ${status}`);

        const getBlocksStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "ページ取得中");
        const blocks = await this.notionClient.getPageBlocks(pageId);
        const comments = await this.notionClient.getPageComments(pageId);
        console.log(`\x1b[35mブロック取得完了\x1b[0m`);
        const getBlocksEndTime = performance.now();
        // console.log(JSON.stringify(blocks, null, 2));
        console.log(JSON.stringify(comments, null, 2));
        this.times.push({ name: "getBlocks", value: getBlocksEndTime - getBlocksStartTime });
        await this.generateCompletions(blocks, comments, pageId, pageTitle, categories, status, false);

      } catch (error) {
        const endTime = performance.now();
        console.error(error);
        this.times.push({ name: "entire", value: endTime - this.startTime });
        this.printTimes();
      }
    });

    app.post("/document-completion", async (req, res) => {
      console.log(`\x1b[35mWebhook検知: /document-completion\x1b[0m`);
      // レスポンスを即時返す
      res.status(200).json({ success: true, message: "Webhook received" });

      // 以降の処理を実行
      try {
        this.times = [];
        this.startTime = performance.now();
        const data = req.body.data;
        // console.log(`data: ${JSON.stringify(data, null, 2)}`);
        const pageId = data.id;
        const pageTitle = data.properties["ドキュメント名"].title[0].text.content;
        const categories = data.properties["カテゴリ"].multi_select.map(
          (category: any) => category.name
        );
        const status = data.properties["ステータス"].status.name;

        console.log(`pageTitle: ${pageTitle}`);
        console.log(`categories: ${categories}`);
        console.log(`status: ${status}`);

        const getBlocksStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "ページ取得中");
        const blocks = await this.notionClient.getPageBlocks(pageId);
        const comments = await this.notionClient.getPageComments(pageId);
        console.log(`\x1b[35mブロック取得完了\x1b[0m`);
        const getBlocksEndTime = performance.now();
        // console.log(JSON.stringify(blocks, null, 2));
        console.log(JSON.stringify(comments, null, 2));
        this.times.push({ name: "getBlocks", value: getBlocksEndTime - getBlocksStartTime });
        await this.generateCompletions(blocks, comments, pageId, pageTitle, categories, status, true);
      } catch (error) {
        const endTime = performance.now();
        console.error(error);
        this.times.push({ name: "entire", value: endTime - this.startTime });
        this.printTimes();
      }
    });

    app.post("/task-update-properties", async (req, res) => {
      console.log(`\x1b[35mWebhook検知: /task-update-properties\x1b[0m`);
      // レスポンスを即時返す
      res.status(200).json({ success: true, message: "Webhook received" });

      // 以降の処理を実行
      try {
        this.times = [];
        this.startTime = performance.now();
        const data = req.body.data;
        console.log(`data: ${JSON.stringify(data, null, 2)}`);
        const pageId = data.id;
        const pageTitle = data.properties["タスク名"].title[0].text?.content || "";
        const categories = data.properties["カテゴリ"].multi_select.map(
          (category: any) => category.name
        ) || [];
        const status = data.properties["ステータス"].status.name;
        const priority = data.properties["優先度"].select?.name || "";
        const workload = data.properties["工数レベル"].select?.name || "";
        const pendingByTask = data.properties["次のタスクにより保留中："].relation?.map(
          (relation: any) => relation.id
        ) || [];
        const pendingTask = data.properties["次のタスクを保留中："].relation?.map(
          (relation: any) => relation.id
        ) || [];
        console.log(`pageTitle: ${pageTitle}`);
        console.log(`categories: ${categories}`);
        console.log(`status: ${status}`);
        console.log(`priority: ${priority}`);
        console.log(`workload: ${workload}`);
        console.log(`pendingByTask: ${pendingByTask}`);
        console.log(`pendingTask: ${pendingTask}`);

        // ページのプロパティを取得
        const getBlocksStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "ページ取得中");
        const blocks = await this.notionClient.getPageBlocks(pageId);
        const comments = await this.notionClient.getPageComments(pageId);
        console.log(`\x1b[35mブロック取得完了\x1b[0m`);
        const getBlocksEndTime = performance.now();
        this.times.push({ name: "getBlocks", value: getBlocksEndTime - getBlocksStartTime });

        // 関連情報を取得
        const getRelatedDocumentsStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "関連情報取得中");
        const contextContent = await this.completionGenerator.getRelatedDocuments(pageTitle, categories, blocks);
        const getRelatedDocumentsEndTime = performance.now();
        this.times.push({ name: "getRelatedDocuments", value: getRelatedDocumentsEndTime - getRelatedDocumentsStartTime });

        // AI生成
        const generateStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "AI生成中");
        const propertyUpdates = await this.completionGenerator.generatePropertyUpdates(
          pageTitle,
          categories,
          status,
          priority,
          workload,
          pendingByTask,
          pendingTask,
          blocks,
          comments,
          contextContent
        );
        const generateEndTime = performance.now();
        this.times.push({ name: "generate", value: generateEndTime - generateStartTime });
        console.log(`\x1b[35m生成されたプロパティ更新: ${JSON.stringify(propertyUpdates, null, 2)}\x1b[0m`);

        // プロパティの更新
        const updateStartTime = performance.now();
        await this.notionClient.updateCompletionStatus(pageId, "ページ更新中");
        await this.notionClient.updatePageProperties(pageId, propertyUpdates);
        const updateEndTime = performance.now();
        this.times.push({ name: "insert", value: updateEndTime - updateStartTime });

        await this.notionClient.updateCompletionStatus(pageId, "完了");
        const endTime = performance.now();
        this.times.push({ name: "entire", value: endTime - this.startTime });
        this.printTimes();
      } catch (error) {
        const endTime = performance.now();
        console.error(error);
        this.times.push({ name: "entire", value: endTime - this.startTime });
        this.printTimes();
      }
    });

    app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
      console.log('Headers:', req.headers);
      console.log('Body:', req.body);
      next();
    });

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  }

  async generateCompletions(blocks: BlockContent[], comments: NotionComment[], pageId: string, pageTitle: string, categories: string[], status: string, isDocument: boolean) {
    try {
      const getRelatedDocumentsStartTime = performance.now();
      await this.notionClient.updateCompletionStatus(pageId, "関連情報取得中");
      const contextContent = await this.completionGenerator.getRelatedDocuments(pageTitle, categories, blocks);
      console.log(`\x1b[35m関連情報取得完了\x1b[0m`);
      console.log(`\x1b[35m関連情報: ${contextContent}\x1b[0m`);
      const getRelatedDocumentsEndTime = performance.now();
      this.times.push({ name: "getRelatedDocuments", value: getRelatedDocumentsEndTime - getRelatedDocumentsStartTime });
      const generateStartTime = performance.now();
      await this.notionClient.updateCompletionStatus(pageId, "AI生成中");
      const completions = await this.completionGenerator.generateCompletions(
        blocks,
        comments,
        pageTitle,
        categories,
        status,
        contextContent,
        isDocument
      );
      console.log(`\x1b[35mAI生成完了\x1b[0m`);
      const generateEndTime = performance.now();
      this.times.push({ name: "generate", value: generateEndTime - generateStartTime });
      console.log(JSON.stringify(completions, null, 2));
      const insertStartTime = performance.now();
      await this.notionClient.updateCompletionStatus(pageId, "ページ更新中");
      if (comments.length > 0) {
        await this.notionClient.insertCompletionWithComments(completions, pageId);
      } else {
        await this.notionClient.insertCompletion(completions, pageId);
      }
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
