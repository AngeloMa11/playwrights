const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

async function scrapeFathomTranscript(videoUrl) {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await chromium.launch({ headless: true });
        console.log('Browser launched successfully');
        const page = await browser.newPage();
        await page.goto(videoUrl, { waitUntil: 'networkidle' });

        await page.waitForSelector('page-call-detail-transcript', { state: 'attached', timeout: 40000 });

        const showButton = await page.$('button:has-text("transcript"), button:has-text("show transcript"), [aria-label*="transcript"], [role="button"][aria-label*="captions"]');
        if (showButton) {
            await showButton.click();
            await page.waitForTimeout(2000);
        }

        await page.waitForTimeout(5000);

        let transcriptElements = await page.$$('page-call-detail-transcript div[class*="transcript-line"], page-call-detail-transcript div[class*="transcript-text"], page-call-detail-transcript div');
        let transcript = [];

        if (transcriptElements.length > 0) {
            for (const element of transcriptElements) {
                const text = await element.innerText();
                const cleanedText = text.trim();
                if (cleanedText && !cleanedText.startsWith('[')) {
                    transcript.push(cleanedText);
                }
            }
        } else {
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
    res.send('Server is running!');
});

app.post('/scrape', async (req, res) => {
    const { videoUrl } = req.body;
    if (!videoUrl) {
        return res.status(400).json({ error: 'Missing videoUrl' });
    }
    const transcript = await scrapeFathomTranscript(videoUrl);
    res.json({ transcript });
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
