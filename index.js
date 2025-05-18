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
    // Reduced timeout to 120 seconds and use 'load' for faster initial load
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 120000 });
    console.log('Navigation completed (page loaded)');

    // Check for redirects or login pages
    const currentUrl = page.url();
    console.log(`Current URL after navigation: ${currentUrl}`);
    if (!currentUrl.includes('fathom.video/share')) {
      console.log('Redirected to unexpected URL, checking for login...');
      const emailInput = await page.$('input[name="email"], input[type="email"]');
      if (emailInput) {
        console.log('Login page detected, attempting authentication...');
        await page.fill('input[name="email"], input[type="email"]', 'your-email@example.com'); // Replace with actual email
        await page.fill('input[name="password"], input[type="password"]', 'your-password'); // Replace with actual password
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });
        console.log('Login attempted, new URL:', page.url());
      } else {
        throw new Error('Redirected to unexpected URL, possibly a login page');
      }
    }

    // Wait for transcript container with reduced timeout
    const transcriptPath = 'page-call-detail-transcript';
    let transcriptContainer = null;
    try {
      transcriptContainer = await page.waitForSelector(transcriptPath, { state: 'attached', timeout: 60000 });
    } catch (err) {
      console.error('Transcript container not found:', err.message);
      throw new Error('Transcript container not found');
    }
    console.log('Transcript container found');

    // Click transcript button if present
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
      await page.waitForTimeout(2000); // Minimal wait for content to appear
      console.log('Transcript button clicked');
    } else {
      console.log('Transcript button not found, proceeding without click.');
    }

    let transcriptElements = await page.$$('page-call-detail-transcript div[class*="transcript-line"], page-call-detail-transcript div[class*="transcript-text"], page-call-detail-transcript div');
    let transcript = [];

    if (transcriptElements.length > 0) {
      console.log(`${transcriptElements.length} transcript elements found (specific classes).`);
      for (const element of transcriptElements) {
        let text;
        if (await element.isVisible()) {
          text = await element.innerText({ timeout: 30000 });
        } else {
          console.log('Element hidden, forcing text extraction...');
          text = await element.evaluate(el => el.textContent || el.innerText);
        }
        const cleanedText = text.trim();
        if (cleanedText && !cleanedText.startsWith('[')) {
          transcript.push(cleanedText);
        }
      }
    } else {
      console.log('Specific transcript elements not found, trying all elements.');
      transcriptElements = await page.$$('page-call-detail-transcript *');
      for (const element of transcriptElements) {
        let text;
        if (await element.isVisible()) {
          text = await element.innerText({ timeout: 30000 });
        } else {
          console.log('Element hidden, forcing text extraction...');
          text = await element.evaluate(el => el.textContent || el.innerText);
        }
        const cleanedText = text.trim();
        if (cleanedText && !cleanedText.startsWith('[')) {
          transcript.push(cleanedText);
        }
      }
    }

    const transcriptText = transcript.length > 0 ? transcript.join('\n') : 'No transcript found.';
    console.log('Transcript scraped:', transcriptText);
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
  const maxAttempts = 3; // Reduced to 3 for faster failure

  while (attempt < maxAttempts) {
    console.log(`Attempt ${attempt + 1} of ${maxAttempts}`);
    try {
      transcript = await scrapeFathomTranscript(videoUrl);
      if (!transcript.startsWith('Transcript unavailable')) break;
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
    }
    attempt++;
    if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 10000)); // Reduced to 10 seconds
  }

  res.json({ transcript });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Transcript service running on port ${PORT}`);
});
