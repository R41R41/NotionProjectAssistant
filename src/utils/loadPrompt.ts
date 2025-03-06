import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type Prompts = "task_completion_with_comments" | "task_completion" | "document_completion_with_comments" | "document_completion" | "update_properties";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const loadPrompt = async (promptType: Prompts): Promise<string> => {
  try {
    const path = join(__dirname, "../langchain/prompts", `${promptType}.md`);
    console.log("Loading prompt from:", path);
    return readFileSync(path, "utf-8").trim();
  } catch (error) {
    console.error(`Failed to load prompt for ${promptType}:`, error);
    throw new Error(`プロンプトの読み込みに失敗しました: ${promptType}`);
  }

};
