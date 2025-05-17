const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

async function scrapeFathomTranscript(videoUrl) {
  let browser;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(videoUrl, { waitUntil: 'load', timeout: 60000 });
    console.log(`Navigated to ${videoUrl}`);

    // Extract metadata from #app[data-page]
    const meta = await page.evaluate(() => {
      const appDiv = document.querySelector('#app');
      if (!appDiv) return {};

      const data = appDiv.getAttribute('data-page');
      if (!data) return {};

      try {
        const parsed = JSON.parse(data);
        const call = parsed?.props?.call;
        const durationSec = parsed?.props?.duration;
        const startedAt = call?.started_at;

        const callDate = startedAt ? new Date(startedAt).toISOString().split('T')[0] : 'Unknown';
        const durationMin = Math.floor(durationSec / 60);
        const durationRemSec = Math.floor(durationSec % 60);

        return {
          CallDate: callDate,
          SalespersonName: call?.byline || 'Unknown',
          ProspectName: call?.host?.email || 'Unknown',
          CallDuration: `${durationMin} minutes ${durationRemSec} seconds`,
          TranscriptLink: call?.video_url || 'Unavailable',
        };
      } catch (err) {
        return {};
      }
    });

    // Wait and try to reveal transcript if needed
    await page.waitForSelector('page-call-detail-transcript', { state: 'attached', timeout: 60000 });

    const showButtonSelectors = [
      'button:has-text("transcript")',
      'button:has-text("show transcript")',
      '[aria-label*="transcript"]',
      '[role="button"][aria-label*="captions"]'
    ];

    for (const selector of showButtonSelectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(2000);
        break;
      }
    }

    await page.waitForTimeout(5000);

    // Scrape transcript
    let transcript = [];
    let transcriptElements = await page.$$('page-call-detail-transcript div[class*="transcript-line"], page-call-detail-transcript div[class*="transcript-text"], page-call-detail-transcript div');

    if (transcriptElements.length === 0) {
      transcriptElements = await page.$$('page-call-detail-transcript *');
    }

    for (const element of transcriptElements) {
      const text = await element.innerText();
      const cleanedText = text.trim();
      if (cleanedText && !cleanedText.startsWith('[')) {
        transcript.push(cleanedText);
      }
    }

    const transcriptText = transcript.length > 0 ? transcript.join('\n') : 'No transcript found.';

    return {
      ...meta,
      Transcript: transcriptText,
    };
  } catch (error) {
    return { error: `Error scraping: ${error.message}` };
  } finally {
    if (browser) await browser.close();
    console.log('Browser closed');
  }
}

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.post('/scrape', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }
  const result = await scrapeFathomTranscript(videoUrl);
  res.json(result);
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
