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

// ドキュメントメタデータの型定義
interface DocumentMetadata {
    id: string;
    title: string;
    categories?: string[];
    status?: string;
    url?: string;
    database: "backlog" | "document";
    score?: number;
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

        try {
            console.log(`\x1b[35m検索実行: ${query.substring(0, 100)}...\x1b[0m`);

            // 検索オプションを設定
            const searchOptions = {
                k: limit * 2, // 候補を多めに取得して後でフィルタリング
                fetchK: limit * 3, // 検索対象数を増やして多様性を確保
                filter: undefined // フィルタリングが必要な場合はここで設定
            };

            // 類似度スコア付きで検索結果を取得
            const results = await this.vectorStore.similaritySearchWithScore(query, searchOptions.k, searchOptions.filter);

            // スコアでソートして、最も関連性の高いドキュメントを取得
            const sortedResults = results
                .sort((a, b) => b[1] - a[1]) // スコアの降順でソート
                .slice(0, limit); // 上位N件を取得

            // スコアをメタデータに追加
            const docsWithScore = sortedResults.map(([doc, score]) => {
                // スコアをメタデータに追加
                return new Document({
                    pageContent: doc.pageContent,
                    metadata: {
                        ...doc.metadata,
                        score: score // 類似度スコアを追加
                    }
                });
            });

            console.log(`\x1b[35m検索結果: ${docsWithScore.length}件\x1b[0m`);
            // 上位3件のスコアをログ出力
            docsWithScore.slice(0, 3).forEach((doc, i) => {
                const metadata = doc.metadata as DocumentMetadata;
                console.log(`\x1b[35m[${i + 1}] スコア: ${metadata.score?.toFixed(4)}, タイトル: ${metadata.title || '不明'}\x1b[0m`);
            });

            return docsWithScore;
        } catch (error) {
            console.error(`検索エラー: ${error}`);
            return []; // エラー時は空配列を返す
        }
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