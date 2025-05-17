const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

async function scrapeFathomTranscript(videoUrl) {
  let browser;
  try {
    console.log('Launching browser for transcript...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(videoUrl, { waitUntil: 'load', timeout: 60000 });
    console.log(`Navigated to ${videoUrl} for transcript`);

    await page.waitForSelector('page-call-detail-transcript', { state: 'attached', timeout: 60000 });
    console.log('Transcript container found');

    const showButtonSelectors = [
      'button:has-text("transcript")',
      'button:has-text("show transcript")',
      '[aria-label*="transcript"]',
      '[role="button"][aria-label*="captions"]'
    ];

    let showButton = null;
    for (const selector of showButtonSelectors) {
      showButton = await page.$(selector);
      if (showButton) break;
    }

    if (showButton) {
      console.log('Transcript button found, clicking...');
      await showButton.click();
      await page.waitForTimeout(2000);
      console.log('Transcript button clicked');
    } else {
      console.log('Transcript button not found.');
    }

    await page.waitForTimeout(5000);
    let transcriptElements = await page.$$('page-call-detail-transcript div[class*="transcript-line"], page-call-detail-transcript div[class*="transcript-text"], page-call-detail-transcript div');
    let transcript = [];

    if (transcriptElements.length > 0) {
      console.log(`${transcriptElements.length} transcript elements found.`);
      for (const element of transcriptElements) {
        const text = await element.innerText();
        const cleanedText = text.trim();
        if (cleanedText && !cleanedText.startsWith('[')) {
          transcript.push(cleanedText);
        }
      }
    } else {
      console.log('Specific transcript elements not found, trying all elements.');
      transcriptElements = await page.$$('page-call-detail-transcript *');
      for (const element of transcriptElements) {
        const text = await element.innerText();
        const cleanedText = text.trim();
        if (cleanedText && !cleanedText.startsWith('[')) {
          transcript.push(cleanedText);
        }
      }
    }

    const transcriptText = transcript.length > 0 ? transcript.join('\n') : 'No transcript found.';
    console.log('Transcript scraped:', transcriptText);
    return transcriptText;
  } catch (err) {
    console.error('Transcript scraping error:', err.message);
    return `Transcript unavailable: ${err.message}`;
  } finally {
    if (browser) await browser.close().catch(err => console.error('Browser close failed:', err.message));
    console.log('Browser closed');
  }
}

app.post('/scrape', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }

  let browser;
  try {
    console.log('Launching browser for metadata scraping...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 60000 });
    console.log(`Navigated to ${videoUrl} for metadata`);

    // Wait for #app to exist in the DOM (not necessarily visible)
    const appDataHandle = await page.waitForSelector('#app', { state: 'attached', timeout: 30000 });
    if (!appDataHandle) {
      throw new Error('#app element not found in the DOM');
    }
    console.log('#app element found in DOM');

    // Get the data-page attribute
    let dataPageJson = await appDataHandle.getAttribute('data-page');
    if (!dataPageJson) {
      throw new Error('data-page attribute not found on #app element');
    }

    // Clean up the JSON string by removing invalid characters and fixing quotes
    dataPageJson = dataPageJson.replace(/[\u0000-\u001F]+/g, ''); // Remove control characters
    const dataPage = JSON.parse(dataPageJson);
    console.log('data-page attribute parsed successfully');

    const callData = dataPage.props.call;

    const CallDate = new Date(callData.started_at).toISOString().split('T')[0];
    const SalespersonName = callData.host?.email || 'Unknown';
    const ProspectName = callData.byline || 'Unknown';
    const CallDurationSeconds = dataPage.props.duration || 0;
    const minutes = Math.floor(CallDurationSeconds / 60);
    const seconds = Math.round(CallDurationSeconds % 60);
    const CallDuration = `${minutes} minutes ${seconds} seconds`;
    const TranscriptLink = callData.video_url || videoUrl;
    const Title = callData.title || 'No Title';

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
    res.status(500).json({ error: `Failed to scrape call data: ${err.message}` });
  } finally {
    if (browser) await browser.close().catch(err => console.error('Browser close failed:', err.message));
    console.log('Browser closed');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
