export const HF_DAILY = [
  {
    title: 'Teachable Prefixes',
    numComments: 4,
    paper: {
      id: '2611.08179',
      title: 'Knowing When to Teach',
      summary: 'On-policy self-distillation   improves\nreasoning by training a student.',
      upvotes: 42,
      publishedAt: '2026-11-03T10:00:00.000Z',
      submittedOnDailyAt: '2026-11-07T00:00:00.000Z',
      authors: [{ name: 'Ada A' }, { name: 'Bo B' }],
    },
  },
  {
    numComments: 0,
    paper: {
      id: '2611.00001',
      title: 'Too old',
      summary: 'Old abstract',
      upvotes: 100,
      publishedAt: '2026-10-01T10:00:00.000Z',
    },
  },
  { numComments: 0, paper: { id: '2611.00002', title: '', summary: 'x', publishedAt: 'bad' } },
]

export const ARXIV_ATOM = `<?xml version='1.0'?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.09868v1</id>
    <title>CodeQuant2: Outlier
      Mitigation</title>
    <summary>Large reasoning models improve task performance with $2.85\\times$ speedup.</summary>
    <published>2026-11-08T18:48:04Z</published>
    <author><name>Xingyu Liu</name></author>
    <author><name>Sai Zhang</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2611.08179v2</id>
    <title>Knowing When to Teach</title>
    <summary>Duplicate of the HF paper.</summary>
    <published>2026-11-07T10:00:00Z</published>
    <author><name>Ada A</name></author>
  </entry>
</feed>`

const filler = (n: number) => 'We study the problem carefully and report results. '.repeat(n)

export const ARXIV_HTML = `<html><body><article>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">1 </span>Introduction</h2>
<p>Reasoning is hard. The loss is <math alttext="L=0"><mi>L</mi></math> in the limit. ${filler(20)}</p></section>
<section id="S2" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">2 </span>Related Work</h2><p>UNRELATED-MARKER</p></section>
<section id="S6" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">6 </span>Conclusion</h2>
<p>We conclude that teachers drift. ${filler(10)}</p></section>
<section class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2><p>BIB-MARKER</p></section>
</article></body></html>`
