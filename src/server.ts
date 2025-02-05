import express from "express";
import { NotionClient } from "./notion/client.js";
import { CompletionGenerator } from "./langchain/completion.js";
import { CompletionResult } from "./notion/types.js";
const app = express();
app.use(express.json());

const notionClient = new NotionClient();
const completionGenerator = await CompletionGenerator.initialize();

app.post("/webhook", async (req, res) => {
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
    const blocks = await notionClient.getPageBlocks(pageId);

    console.log(JSON.stringify(blocks, null, 2));

    if (blocks.length === 0) {
      // 新規ページの場合、AI補完を生成
      const response = await completionGenerator.generateCreate(
        pageTitle,
        categories,
        status
      );

      console.log(JSON.stringify(response, null, 2));
      // 補完内容をNotionに追加
      await notionClient.createInitialBlocks(pageId, response);

    } else {
      // AI補完を生成
      const completions = await completionGenerator.generateCompletions(
        blocks,
        pageTitle,
        categories,
        status
      );
      console.log(JSON.stringify(completions, null, 2));
      // 補完内容をNotionに追加
      await notionClient.insertCompletion(completions, pageId);
    }
    res.status(200).json({ success: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
