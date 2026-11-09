export const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Blog</title>
    <item>
      <title><![CDATA[Announcing Workers &amp; Queues v2]]></title>
      <link>https://blog.example.com/queues-v2?utm_source=rss</link>
      <guid isPermaLink="false">post-123</guid>
      <pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate>
      <description>Short summary</description>
      <content:encoded><![CDATA[<p>Queues v2 is <b>here</b>.</p><p>It ships batching &amp; retries.</p><script>evil()</script>]]></content:encoded>
    </item>
    <item>
      <title>Old post</title>
      <link>https://blog.example.com/old</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>&lt;p&gt;Escaped &amp;amp; html&lt;/p&gt;</description>
    </item>
    <item>
      <title>No link</title>
      <pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Bad date</title>
      <link>https://blog.example.com/bad-date</link>
      <pubDate>not a date</pubDate>
      <description>x</description>
    </item>
  </channel>
</rss>`

export const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link rel="self" href="https://atom.example.com/feed.xml"/>
  <entry>
    <title type="html">Rust 2.0 &amp;mdash; released</title>
    <link rel="alternate" type="text/html" href="https://atom.example.com/rust-2?a=1&amp;b=2"/>
    <link rel="enclosure" href="https://atom.example.com/file.mp3"/>
    <id>tag:atom.example.com,2026:rust-2</id>
    <published>2026-11-08T09:30:00Z</published>
    <updated>2026-11-08T11:00:00Z</updated>
    <summary>Summary text</summary>
    <content type="html">&lt;p&gt;Full &lt;em&gt;content&lt;/em&gt; here&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Updated only</title>
    <link href="https://atom.example.com/updated-only"/>
    <id>u1</id>
    <updated>2026-11-07T00:00:00Z</updated>
  </entry>
</feed>`
