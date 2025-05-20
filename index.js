const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

async function scrapeFathomTranscript(videoUrl) {
  let browser;
  try {
    console.log('Launching browser for transcript...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: null });

    console.log('Navigating to', videoUrl);
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 120000 });
    console.log('Navigation completed');

    const currentUrl = page.url();
    if (!currentUrl.includes('fathom.video/share')) {
      const emailInput = await page.$('input[name="email"], input[type="email"]');
      if (emailInput) {
        console.log('Login required – please automate login or provide shared link');
        throw new Error('Login page detected, cannot proceed with shared link scraping');
      }
    }

    const transcriptContainer = await page.waitForSelector('page-call-detail-transcript', {
      state: 'attached',
      timeout: 60000,
    });
    console.log('Transcript container found');

    await page.evaluate(() => {
      const el = document.querySelector('page-call-detail-transcript');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(2000);

    const transcriptElements = await page.$$(
      'page-call-detail-transcript div[class*="transcript-line"], div[class*="transcript-text"]'
    );

    const transcript = [];
    for (const element of transcriptElements) {
      let text;
      if (await element.isVisible()) {
        text = await element.innerText({ timeout: 30000 });
      } else {
        text = await element.evaluate(el => el.textContent || el.innerText);
      }
      const cleanedText = text.trim();

      if (
        cleanedText &&
        !cleanedText.toLowerCase().includes('resume auto-scroll') &&
        !cleanedText.startsWith('[')
      ) {
        transcript.push(cleanedText);
      }
    }

    const transcriptText = transcript.length > 0 ? transcript.join('\n') : 'No transcript found.';
    console.log('Transcript scraped successfully');
    return transcriptText;

  } catch (error) {
    const errorMessage = `Error scraping transcript: ${error.message}`;
    console.error(errorMessage);
    return errorMessage;
  } finally {
    if (browser) await browser.close().catch(err => console.error('Browser close failed:', err.message));
    console.log('Browser closed');
  }
}

app.get('/', (req, res) => {
  res.send('Transcript service is running!');
});

app.post('/scrape-transcript', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }

  let transcript = 'Transcript unavailable';
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    console.log(`Attempt ${attempt + 1} of ${maxAttempts}`);
    try {
      transcript = await scrapeFathomTranscript(videoUrl);
      if (!transcript.startsWith('Transcript unavailable')) break;
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
    }
    attempt++;
    if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 10000));
  }

  res.json({ transcript });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Transcript service running on port ${PORT}`);
});
