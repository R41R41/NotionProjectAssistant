import express from "express";
import { NotionClient } from "./notion/client.js";
import { CompletionGenerator } from "./langchain/completion.js";

const app = express();
app.use(express.json());

const notionClient = new NotionClient();
const completionGenerator = await CompletionGenerator.create();

app.post("/webhook", async (req, res) => {
  try {
    const pageId = req.body.pageId;

    // Notionページのブロックを取得
    const blocks = await notionClient.getPageBlocks(pageId);

    console.log(JSON.stringify(blocks, null, 2));

    // AI補完を生成
    const completions = await completionGenerator.generateCompletions(blocks);

    console.log(JSON.stringify(completions, null, 2));

    // 補完内容をNotionに追加
    await notionClient.insertCompletion(completions);

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
