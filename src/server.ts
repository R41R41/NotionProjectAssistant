import express from "express";
import { NotionClient } from "./notion/client.js";
import { CompletionGenerator } from "./langchain/completion.js";
const app = express();
app.use(express.json());

const notionClient = new NotionClient();
const completionGenerator = await CompletionGenerator.initialize();

app.post("/webhook", async (req, res) => {
  res.status(200).json({ success: true });
  const startTime = performance.now();
  try {
    const data = req.body.data;
    console.log(`data: ${JSON.stringify(data, null, 2)}`);
    const pageId = data.id;
    const pageTitle = data.properties["名前"].title[0].text.content;
    const categories = data.properties["カテゴリ"].multi_select.map(
      (category: any) => category.name
    );
    const status = data.properties["状態"].status.name;

    console.log(`pageTitle: ${pageTitle}`);
    console.log(`categories: ${categories}`);
    console.log(`status: ${status}`);

    // Notionページのブロックを取得
    const getBlocksStartTime = performance.now();
    const blocks = await notionClient.getPageBlocks(pageId);
    const getBlocksEndTime = performance.now();
    console.log(
      `Notionページのブロックを取得: ${(
        getBlocksEndTime - getBlocksStartTime
      ).toFixed(2)}ms`
    );
    // console.log(JSON.stringify(blocks, null, 2));

    const generateStartTime = performance.now();
    const completions = await completionGenerator.generateTaskFullCompletions(
      blocks,
      pageTitle,
      categories,
      status
    );
    const generateEndTime = performance.now();
    console.log(
      `AI生成時間: ${(generateEndTime - generateStartTime).toFixed(2)}ms`
    );
    console.log(JSON.stringify(completions, null, 2));
    await notionClient.insertCompletion(completions, pageId);
    const endTime = performance.now();
    console.log(`総実行時間: ${(endTime - startTime).toFixed(2)}ms`);
  } catch (error) {
    const endTime = performance.now();
    console.error(error);
    console.log(`エラーまでの実行時間: ${(endTime - startTime).toFixed(2)}ms`);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
