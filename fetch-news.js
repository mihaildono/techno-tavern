#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const RSS_FEED_URL = 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Foffnews.bg%2Frss%2Fall';
const OUTPUT_FILE = path.join(__dirname, 'news.json');

console.log('📡 Fetching RSS feed from OffNews.bg...');

https.get(RSS_FEED_URL, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const feedData = JSON.parse(data);
      
      if (!feedData.items || feedData.items.length === 0) {
        console.error('❌ No items found in RSS feed');
        process.exit(1);
      }

      const output = {
        items: feedData.items.slice(0, 5).map(item => ({
          title: item.title,
          link: item.link,
          description: item.description,
          pubDate: item.pubDate,
          thumbnail: item.thumbnail || item.enclosure || null
        })),
        lastUpdated: new Date().toISOString()
      };

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
      
      console.log('✅ Successfully updated news.json');
      console.log(`📰 Fetched ${output.items.length} articles`);
      console.log(`🕐 Last updated: ${output.lastUpdated}`);
      
      // Show which articles have thumbnails
      const withThumbnails = output.items.filter(item => item.thumbnail).length;
      console.log(`🖼️  Articles with images: ${withThumbnails}/${output.items.length}`);
      
    } catch (error) {
      console.error('❌ Error parsing RSS data:', error.message);
      process.exit(1);
    }
  });

}).on('error', (error) => {
  console.error('❌ Error fetching RSS feed:', error.message);
  process.exit(1);
});
