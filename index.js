const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configure timeouts and retry logic
const NAVIGATION_TIMEOUT = 90000; // Increased from 60s to 90s
const PAGE_LOAD_TIMEOUT = 45000;  // Separate timeout for initial page load
const MAX_RETRIES = 2;            // Number of retries for failed operations

async function scrapeFathomTranscript(videoUrl, retryCount = 0) {
  let browser;
  try {
    console.log(`Launching browser for transcript (attempt ${retryCount + 1})...`);
    browser = await chromium.launch({ 
      headless: true,
      // Add these args to reduce memory usage and improve stability
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-extensions'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      bypassCSP: true  // Bypass Content Security Policy
    });
    
    const page = await context.newPage();
    
    // Set long timeout for page operations
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);
    
    // Navigate with more relaxed conditions
    console.log(`Navigating to ${videoUrl} for transcript`);
    await page.goto(videoUrl, { 
      waitUntil: 'domcontentloaded', // Changed from 'networkidle' to 'domcontentloaded'
      timeout: PAGE_LOAD_TIMEOUT 
    });
    
    console.log('Page loaded, waiting for content to initialize...');
    await page.waitForTimeout(5000); // Wait for JS to initialize
    
    // Check if we need to handle a login page or other roadblock
    const loginForm = await page.$('form[action*="login"], input[name="password"]');
    if (loginForm) {
      console.log('Login page detected - unable to proceed');
      return 'Transcript unavailable: Login required';
    }
    
    // Wait for transcript container with progressive approach
    let transcriptFound = false;
    try {
      await page.waitForSelector('page-call-detail-transcript', { 
        state: 'attached', 
        timeout: 30000  // Reduced from 60s
      });
      transcriptFound = true;
      console.log('Transcript container found');
    } catch (err) {
      console.log('Transcript container not found, will try alternative methods');
    }
    
    // Try to find and click on transcript button with multiple approaches
    const showButtonSelectors = [
      'button:has-text("transcript")',
      'button:has-text("show transcript")',
      '[aria-label*="transcript" i]', // Case insensitive
      '[role="button"][aria-label*="captions" i]',
      'button:has-text("captions")',
      '[data-test-id*="transcript"]',
      // Add classes that might be used for transcript buttons
      '.transcript-button',
      '.show-transcript'
    ];
    
    let buttonClicked = false;
    for (const selector of showButtonSelectors) {
      try {
        const showButton = await page.$(selector);
        if (showButton) {
          console.log(`Transcript button found with selector "${selector}", clicking...`);
          await showButton.click({ timeout: 5000 }).catch(e => console.log('Click failed:', e.message));
          buttonClicked = true;
          await page.waitForTimeout(8000); // Wait after clicking
          break;
        }
      } catch (err) {
        console.log(`Error trying selector "${selector}":`, err.message);
      }
    }
    
    if (!buttonClicked) {
      console.log('No transcript button found, will attempt to find transcript directly');
    }
    
    // Increased wait for transcript to load
    await page.waitForTimeout(8000);
    
    // Multiple approaches to find transcript content
    let transcript = [];
    
    // 1. Try with specific selectors
    const selectors = [
      'page-call-detail-transcript div[class*="transcript-line"]', 
      'page-call-detail-transcript div[class*="transcript-text"]',
      'page-call-detail-transcript div',
      'div[class*="transcript"]',
      '.transcript-container p',
      '.transcript-text',
      '[data-test-id*="transcript-text"]'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} transcript elements with selector "${selector}"`);
          for (const element of elements) {
            try {
              const text = await element.innerText({ timeout: 5000 });
              const cleanedText = text.trim();
              if (cleanedText && !cleanedText.startsWith('[') && transcript.indexOf(cleanedText) === -1) {
                transcript.push(cleanedText);
              }
            } catch (err) {
              console.log('Error extracting text from element:', err.message);
            }
          }
          
          if (transcript.length > 0) break;
        }
      } catch (err) {
        console.log(`Error with selector "${selector}":`, err.message);
      }
    }
    
    // 2. If no transcript found, try evaluating page content directly
    if (transcript.length === 0) {
      console.log('No transcript found with selectors, trying to extract text from page');
      
      // Extract text using JavaScript evaluation in the page context
      transcript = await page.evaluate(() => {
        // Function to get all text nodes in the document
        const getTextNodes = (node) => {
          const nodes = [];
          if (node.nodeType === 3) { // Text node
            const text = node.textContent.trim();
            if (text && !text.startsWith('[') && text.length > 10) {
              nodes.push(text);
            }
          } else {
            for (let i = 0; i < node.childNodes.length; i++) {
              nodes.push(...getTextNodes(node.childNodes[i]));
            }
          }
          return nodes;
        };
        
        // Start with any transcript container if available
        const transcriptContainer = document.querySelector('page-call-detail-transcript') || 
                                     document.querySelector('[class*="transcript"]') ||
                                     document.body;
        
        return getTextNodes(transcriptContainer);
      });
    }
    
    const transcriptText = transcript.length > 0 ? transcript.join('\n') : 'No transcript found.';
    console.log(`Transcript scraped (${transcript.length} lines found)`);
    return transcriptText;
  } catch (err) {
    console.error('Transcript scraping error:', err.message);
    
    // Implement retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying transcript scraping (attempt ${retryCount + 2})...`);
      return scrapeFathomTranscript(videoUrl, retryCount + 1);
    }
    
    return `Transcript unavailable: ${err.message}`;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (err) {
        console.error('Browser close failed:', err.message);
      }
    }
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
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-extensions'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);
    
    console.log(`Navigating to ${videoUrl} for metadata`);
    await page.goto(videoUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: PAGE_LOAD_TIMEOUT 
    });
    
    console.log('Page loaded, waiting for content...');
    await page.waitForTimeout(5000);

    // Primary method: Try to extract data from #app element
    let callData = null;
    try {
      const appDataHandle = await page.waitForSelector('#app', { 
        state: 'attached', 
        timeout: 20000 
      });
      
      if (appDataHandle) {
        console.log('#app element found in DOM');
        const dataPageJson = await appDataHandle.getAttribute('data-page');
        
        if (dataPageJson) {
          // Clean JSON before parsing
          const cleanedJson = dataPageJson.replace(/[-\u001F]+/g, '');
          try {
            const dataPage = JSON.parse(cleanedJson);
            console.log('data-page attribute parsed successfully');
            callData = dataPage.props.call;
          } catch (jsonErr) {
            console.error('Error parsing data-page JSON:', jsonErr.message);
          }
        } else {
          console.log('data-page attribute not found on #app element');
        }
      }
    } catch (appErr) {
      console.error('Error getting #app element:', appErr.message);
    }

    // Fallback method: Extract data directly from page content
    if (!callData) {
      console.log('Using fallback method to extract metadata');
      callData = await page.evaluate(() => {
        // Look for any script tags with JSON data
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        let extractedData = null;
        
        for (const script of scripts) {
          try {
            const content = script.textContent;
            if (content.includes('"call":') || content.includes('"title":') || content.includes('"video_url":')) {
              // Try to extract JSON data
              const jsonMatch = content.match(/\{.*"call":\s*\{.*\}.*\}/);
              if (jsonMatch) {
                const jsonData = JSON.parse(jsonMatch[0]);
                if (jsonData.props && jsonData.props.call) {
                  extractedData = jsonData.props.call;
                  break;
                }
              }
            }
          } catch (e) {
            // Continue to next script
          }
        }
        
        // If we still don't have data, extract from page content
        if (!extractedData) {
          // Check for title in the DOM
          const title = document.querySelector('h1')?.innerText || 
                       document.querySelector('title')?.innerText ||
                       document.querySelector('.call-title')?.innerText || 'Unknown Title';
          
          // Try to find date information
          let dateText = '';
          const dateElements = document.querySelectorAll('[datetime], time, [class*="date"]');
          for (const el of dateElements) {
            if (el.getAttribute('datetime')) {
              dateText = el.getAttribute('datetime');
              break;
            } else if (el.innerText.match(/\d{4}-\d{2}-\d{2}/) || 
                      el.innerText.match(/\w+ \d{1,2},? \d{4}/)) {
              dateText = el.innerText;
              break;
            }
          }
          
          // Try to find participant information
          const participantElements = document.querySelectorAll('[class*="participant"], [class*="host"], [class*="user"]');
          let host = '';
          let participant = '';
          
          for (const el of participantElements) {
            const text = el.innerText.trim();
            if (text && !host) host = text;
            else if (text && !participant) participant = text;
          }
          
          // Check for date format and sanitize
          const sanitizeDate = (dateStr) => {
            if (!dateStr) return new Date().toISOString();
            
            // Try to parse the date as-is first
            let date = new Date(dateStr);
            
            // If invalid, try different formats
            if (isNaN(date.getTime())) {
              // Try to extract date patterns
              const isoPattern = dateStr.match(/\d{4}-\d{2}-\d{2}/);
              if (isoPattern) {
                return new Date(isoPattern[0]).toISOString();
              }
              
              // Try common date formats
              const commonPattern = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
              if (commonPattern) {
                const months = {
                  'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
                  'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
                  'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5, 'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
                };
                
                const month = months[commonPattern[1].toLowerCase()];
                const day = parseInt(commonPattern[2]);
                const year = parseInt(commonPattern[3]);
                
                if (month !== undefined && !isNaN(day) && !isNaN(year)) {
                  return new Date(year, month, day).toISOString();
                }
              }
              
              // Return current date as fallback
              return new Date().toISOString();
            }
            
            return date.toISOString();
          };
          
          extractedData = {
            title: title,
            started_at: sanitizeDate(dateText),
            host: { email: host || 'Unknown Host' },
            byline: participant || 'Unknown Participant',
            video_url: window.location.href
          };
        }
        
        return extractedData;
      });
    }

    // If still no data, use minimal defaults
    if (!callData) {
      console.log('Could not extract call data, using defaults');
      callData = {
        title: 'Unknown Call',
        started_at: new Date().toISOString(), // Using current date as fallback
        host: { email: 'Unknown Host' },
        byline: 'Unknown Participant',
        video_url: videoUrl
      };
    }
    
    // Ensure started_at is valid
    if (!callData.started_at || typeof callData.started_at !== 'string' || 
        callData.started_at === 'undefined' || callData.started_at === 'null') {
      console.log('Invalid started_at value, using current date');
      callData.started_at = new Date().toISOString();
    }

    // Get duration if available
    let callDurationSeconds = 0;
    try {
      const durationElement = await page.$('[class*="duration"], [data-test-id*="duration"]');
      if (durationElement) {
        const durationText = await durationElement.innerText();
        // Parse common duration formats like "12:34" or "1:23:45"
        const parts = durationText.split(':').map(Number);
        if (parts.length === 2) {
          callDurationSeconds = parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          callDurationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }
    } catch (err) {
      console.log('Error getting duration:', err.message);
    }

    // Format the data
    // Safely parse the date, with error handling
    let CallDate;
    try {
      // First check if started_at is valid
      if (!callData.started_at || callData.started_at === 'undefined' || callData.started_at === 'null') {
        throw new Error('Invalid date value');
      }
      
      // Try to create a date object
      const dateObj = new Date(callData.started_at);
      
      // Check if the date is valid
      if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid date object');
      }
      
      CallDate = dateObj.toISOString().split('T')[0];
    } catch (err) {
      console.log('Error parsing date:', err.message);
      // Fallback to current date
      CallDate = new Date().toISOString().split('T')[0];
    }
    
    const SalespersonName = callData.host?.email || 'Unknown';
    const ProspectName = callData.byline || 'Unknown';
    const minutes = Math.floor(callDurationSeconds / 60);
    const seconds = Math.round(callDurationSeconds % 60);
    const CallDuration = `${minutes} minutes ${seconds} seconds`;
    const TranscriptLink = callData.video_url || videoUrl;
    const Title = callData.title || 'No Title';

    // Now get transcript
    console.log('Getting transcript...');
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
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (err) {
        console.error('Browser close failed:', err.message);
      }
    }
  }
});

// Add a simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fathom scraper service is running' });
});

// Add an endpoint to check configuration
app.get('/config', (req, res) => {
  res.json({
    navigationTimeout: NAVIGATION_TIMEOUT,
    pageLoadTimeout: PAGE_LOAD_TIMEOUT,
    maxRetries: MAX_RETRIES,
    version: '1.1.0'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
