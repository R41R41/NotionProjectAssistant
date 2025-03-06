import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import dotenv from "dotenv";

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
}

export interface NotionPage {
    id: string;
    title: string;
    categories: string[];
    status: string;
    content: string;
    database: "backlog" | "document";
}

export class VectorStoreManager {
    private static instance: VectorStoreManager;
    private vectorStore: MemoryVectorStore | null = null;
    private embeddings: OpenAIEmbeddings;
    private notionPages: NotionPage[] = [];

    private constructor() {
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: OPENAI_API_KEY,
            modelName: "text-embedding-3-small",
        });
    }

    public static getInstance(): VectorStoreManager {
        if (!VectorStoreManager.instance) {
            VectorStoreManager.instance = new VectorStoreManager();
        }
        return VectorStoreManager.instance;
    }

    public async initialize(notionPages: NotionPage[]): Promise<void> {
        console.log(`\x1b[35mベクトルストア初期化中...\x1b[0m`);
        this.notionPages = notionPages;

        const documents = notionPages.map(page => {
            return new Document({
                pageContent: `${page.title}\n${page.content}`,
                metadata: {
                    id: page.id,
                    title: page.title,
                    categories: page.categories,
                    status: page.status,
                    database: page.database
                }
            });
        });

        this.vectorStore = await MemoryVectorStore.fromDocuments(
            documents,
            this.embeddings
        );

        console.log(`\x1b[35mベクトルストア初期化完了: ${documents.length}ページ\x1b[0m`);
    }

    public async searchRelevantDocuments(query: string, limit: number = 5): Promise<Document[]> {
        if (!this.vectorStore) {
            throw new Error("Vector store is not initialized");
        }

        return await this.vectorStore.similaritySearch(query, limit);
    }

    public getNotionPages(): NotionPage[] {
        return this.notionPages;
    }

    public async addPage(page: NotionPage): Promise<void> {
        if (!this.vectorStore) {
            throw new Error("Vector store is not initialized");
        }

        this.notionPages.push(page);

        await this.vectorStore.addDocuments([
            new Document({
                pageContent: `${page.title}\n${page.content}`,
                metadata: {
                    id: page.id,
                    title: page.title,
                    categories: page.categories,
                    status: page.status,
                    database: page.database
                }
            })
        ]);
    }
}