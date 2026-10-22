# Daily news summary

Input: `news/data/news-digest.md`, one headline per line: `id|source|title`.
Output: write ONLY this JSON to `news/data/top-news.json`:

```json
{
  "overview": "1-2 sentences in Bulgarian naming the day's main events.",
  "stories": [
    {
      "category": "Политика",
      "headline": "Short factual headline in Bulgarian",
      "summary": "1-2 sentences in Bulgarian.",
      "ids": [3, 17, 42]
    }
  ]
}
```

Steps:
1. Group lines about the same event.
2. Pick the 5 most important events. Prefer events reported by several sources.
3. For each: category, headline, summary, and the `ids` of ALL lines about it.

Rules:
- `category` is exactly one of: Политика, Икономика, Общество, Свят, Технологии, Култура, Спорт, Здравеопазване, Екология, Други.
- Use only facts, names and numbers from the titles. Invent nothing.
- Correct Bulgarian. Copy names exactly from the titles. Translate English titles.
- No exclamation marks, no clickbait.
- Do not add links, sources or dates. The script adds them.
