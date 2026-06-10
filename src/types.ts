export interface Article {
  lawName: string;
  chapter: string;
  articleNum: string;
  content: string;
  url?: string;
  date?: string;
  docNo?: string;
}

export interface LawData {
  lawName: string;
  lastUpdated: string;
  articles: Article[];
}

export interface SearchResult extends Article {
  score: number;
}
