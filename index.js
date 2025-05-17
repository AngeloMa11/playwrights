const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

async function scrapeFathomTranscript(videoUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-cue-index]', { timeout: 30000 });

    const transcript = await page.evaluate(() => {
      const cues = Array.from(document.querySelectorAll('[data-cue-index]'));
      return cues.map(cue => cue.textContent.trim()).join('\n');
    });

    return transcript;
  } catch (err) {
    console.error('Transcript scraping error:', err.message);
    return 'Transcript unavailable';
  } finally {
    await browser.close();
  }
}

app.post('/scrape', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 60000 });

    // Wait for app data to be available
    await page.waitForSelector('#app', { timeout: 30000 });
    const appDataHandle = await page.$('#app');
    const dataPageJson = await appDataHandle.getAttribute('data-page');
    const dataPage = JSON.parse(dataPageJson);

    const callData = dataPage.props.call;

    // Extract fields
    const CallDate = new Date(callData.started_at).toISOString().split('T')[0];
    const SalespersonName = callData.host?.email || 'Unknown';
    const ProspectName = callData.byline || 'Unknown';
    const CallDurationSeconds = dataPage.props.duration || 0;
    const minutes = Math.floor(CallDurationSeconds / 60);
    const seconds = Math.round(CallDurationSeconds % 60);
    const CallDuration = `${minutes} minutes ${seconds} seconds`;
    const TranscriptLink = callData.video_url || videoUrl;
    const Title = callData.title || 'No Title';

    // Get transcript
    const Transcript = await scrapeFathomTranscript(videoUrl);

    res.json({
      CallDate,
      SalespersonName,
      ProspectName,
      CallDuration,
      TranscriptLink,
      Title,
      Transcript
    });
  } catch (err) {
    console.error('Main scraping error:', err.message);
    res.status(500).json({ error: 'Failed to scrape call data' });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
