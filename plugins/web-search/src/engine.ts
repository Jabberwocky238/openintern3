export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchEngine {
  public async search(query: string, maxResults = 5): Promise<WebSearchResultItem[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new TypeError("query must be a non-empty string.");
    }

    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        q: normalizedQuery,
      }),
    });

    if (!response.ok) {
      throw new Error(`Web search failed: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  private parseResults(html: string, maxResults: number): WebSearchResultItem[] {
    const items: WebSearchResultItem[] = [];
    const resultBlocks = html.match(/<div class="result(?:.|\n|\r)*?<\/div>\s*<\/div>/g) ?? [];

    for (const block of resultBlocks) {
      if (items.length >= maxResults) {
        break;
      }

      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/);
      if (!titleMatch) {
        continue;
      }

      const snippetMatch = block.match(/class="result__snippet"[^>]*>(.*?)<\/a>|class="result__snippet"[^>]*>(.*?)<\/div>/);
      const url = this.decodeHtml(this.stripTags(titleMatch[1]));
      const title = this.decodeHtml(this.stripTags(titleMatch[2]));
      const snippet = this.decodeHtml(this.stripTags(snippetMatch?.[1] ?? snippetMatch?.[2] ?? ""));

      if (!title || !url) {
        continue;
      }

      items.push({
        title,
        url,
        snippet,
      });
    }

    return items;
  }

  private stripTags(value: string): string {
    return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
}
