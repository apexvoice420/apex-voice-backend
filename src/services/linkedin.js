/**
 * LinkedIn Posting Agent
 * Automated LinkedIn post scheduling and publishing via Puppeteer
 * 
 * WARNING: LinkedIn TOS prohibits automation. Use at your own risk.
 * Safe limits: 1-2 posts/day, random delays, human-like behavior
 */

const puppeteer = require('puppeteer');

// Store browser instance for reuse
let browserInstance = null;
let pageInstance = null;

// LinkedIn credentials (set via environment)
const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;

// Random delay helper (human-like behavior)
const randomDelay = (min = 2000, max = 5000) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
};

/**
 * Initialize browser and login to LinkedIn
 */
async function initBrowser() {
    if (browserInstance && pageInstance) {
        return { browser: browserInstance, page: pageInstance };
    }

    console.log('🚀 Launching LinkedIn browser...');
    
    browserInstance = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ],
        defaultViewport: {
            width: 1920,
            height: 1080
        }
    });

    pageInstance = await browserInstance.newPage();
    
    // Set user agent to avoid detection
    await pageInstance.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Login to LinkedIn
    await loginToLinkedIn(pageInstance);

    return { browser: browserInstance, page: pageInstance };
}

/**
 * Login to LinkedIn
 */
async function loginToLinkedIn(page) {
    console.log('🔐 Logging into LinkedIn...');
    
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
    await randomDelay(1000, 2000);

    // Fill in credentials
    await page.type('#username', LINKEDIN_EMAIL, { delay: 50 });
    await randomDelay(500, 1000);
    await page.type('#password', LINKEDIN_PASSWORD, { delay: 50 });
    await randomDelay(500, 1000);

    // Click login
    await page.click('[type="submit"]');
    
    // Wait for navigation
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (e) {
        // Check for 2FA or security challenge
        const currentUrl = page.url();
        if (currentUrl.includes('challenge') || currentUrl.includes('checkpoint')) {
            throw new Error('LinkedIn security challenge detected. Manual login required.');
        }
    }

    // Verify login success
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('uas/login')) {
        throw new Error('LinkedIn login failed. Check credentials.');
    }

    console.log('✅ LinkedIn login successful');
}

/**
 * Post text content to LinkedIn
 */
async function postText(content) {
    try {
        const { page } = await initBrowser();

        console.log('📝 Posting text to LinkedIn...');
        
        // Navigate to feed
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle2' });
        await randomDelay(2000, 3000);

        // Click "Start a post" button
        await page.waitForSelector('[data-test-feed-suggested-filter-bar]', { timeout: 10000 });
        
        // Find and click the post button
        const postButton = await page.waitForSelector('button.share-box-trigger, [data-control-name="actor.pencil"], button[data-control-name="open_share_box"]', { timeout: 10000 });
        await postButton.click();
        await randomDelay(1000, 2000);

        // Wait for post modal
        await page.waitForSelector('[data-test-editor-container], .ql-editor, [contenteditable="true"]', { timeout: 10000 });
        
        // Type the content
        const editor = await page.$('[data-test-editor-container], .ql-editor, [contenteditable="true"]');
        if (editor) {
            await editor.click();
            await randomDelay(500, 1000);
            await page.keyboard.type(content, { delay: 10 });
        } else {
            throw new Error('Could not find post editor');
        }

        await randomDelay(1000, 2000);

        // Click post button
        const submitButton = await page.waitForSelector('button.share-actions__primary-action, [data-control-name="share"]', { timeout: 10000 });
        await submitButton.click();

        // Wait for post to be published
        await randomDelay(3000, 5000);

        // Verify success by checking URL or success message
        await page.waitForSelector('[data-test-toast-success], .artdeast-toast--success', { timeout: 10000 }).catch(() => {});

        console.log('✅ Text post published successfully');
        
        return { success: true, message: 'Post published to LinkedIn' };

    } catch (error) {
        console.error('❌ LinkedIn post error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Post text with PDF document to LinkedIn (creates carousel)
 */
async function postWithPdf(content, pdfPath) {
    try {
        const { page } = await initBrowser();

        console.log('📄 Posting PDF carousel to LinkedIn...');
        
        // Navigate to feed
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle2' });
        await randomDelay(2000, 3000);

        // Click "Start a post" button
        const postButton = await page.waitForSelector('button.share-box-trigger, [data-control-name="actor.pencil"]', { timeout: 10000 });
        await postButton.click();
        await randomDelay(1000, 2000);

        // Click "Add a document" button
        const docButton = await page.waitForSelector('[data-control-name="upload_document"], button[aria-label="Add a document"]', { timeout: 10000 });
        await docButton.click();
        await randomDelay(1000, 2000);

        // Upload the PDF
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        await fileInput.uploadFile(pdfPath);

        // Wait for document to upload and process
        await randomDelay(5000, 8000);

        // Type the content
        const editor = await page.$('[data-test-editor-container], .ql-editor, [contenteditable="true"]');
        if (editor) {
            await editor.click();
            await randomDelay(500, 1000);
            await page.keyboard.type(content, { delay: 10 });
        }

        await randomDelay(1000, 2000);

        // Click post button
        const submitButton = await page.waitForSelector('button.share-actions__primary-action', { timeout: 10000 });
        await submitButton.click();

        // Wait for post to be published
        await randomDelay(5000, 8000);

        console.log('✅ PDF carousel post published successfully');
        
        return { success: true, message: 'PDF carousel published to LinkedIn' };

    } catch (error) {
        console.error('❌ LinkedIn PDF post error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Post text with image to LinkedIn
 */
async function postWithImage(content, imagePath) {
    try {
        const { page } = await initBrowser();

        console.log('🖼️ Posting image to LinkedIn...');
        
        // Navigate to feed
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle2' });
        await randomDelay(2000, 3000);

        // Click "Start a post" button
        const postButton = await page.waitForSelector('button.share-box-trigger, [data-control-name="actor.pencil"]', { timeout: 10000 });
        await postButton.click();
        await randomDelay(1000, 2000);

        // Click image upload button
        const imageButton = await page.waitForSelector('[data-control-name="upload_image"], button[aria-label="Add a photo"]', { timeout: 10000 });
        await imageButton.click();
        await randomDelay(1000, 2000);

        // Upload the image
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        await fileInput.uploadFile(imagePath);

        // Wait for image to upload
        await randomDelay(3000, 5000);

        // Type the content
        const editor = await page.$('[data-test-editor-container], .ql-editor, [contenteditable="true"]');
        if (editor) {
            await editor.click();
            await randomDelay(500, 1000);
            await page.keyboard.type(content, { delay: 10 });
        }

        await randomDelay(1000, 2000);

        // Click post button
        const submitButton = await page.waitForSelector('button.share-actions__primary-action', { timeout: 10000 });
        await submitButton.click();

        // Wait for post to be published
        await randomDelay(5000, 8000);

        console.log('✅ Image post published successfully');
        
        return { success: true, message: 'Post with image published to LinkedIn' };

    } catch (error) {
        console.error('❌ LinkedIn image post error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Close browser (cleanup)
 */
async function closeBrowser() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
        pageInstance = null;
        console.log('🔌 LinkedIn browser closed');
    }
}

/**
 * Check if LinkedIn credentials are configured
 */
function isConfigured() {
    return !!(LINKEDIN_EMAIL && LINKEDIN_PASSWORD);
}

/**
 * Get current user profile info
 */
async function getProfileInfo() {
    try {
        const { page } = await initBrowser();

        await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'networkidle2' });
        await randomDelay(2000, 3000);

        const name = await page.$eval('.text-heading-xlarge', el => el.textContent).catch(() => 'Unknown');
        const headline = await page.$eval('.text-body-medium', el => el.textContent).catch(() => '');

        return { name: name.trim(), headline: headline.trim() };

    } catch (error) {
        return { name: 'Unknown', headline: '', error: error.message };
    }
}

module.exports = {
    initBrowser,
    postText,
    postWithImage,
    postWithPdf,
    closeBrowser,
    isConfigured,
    getProfileInfo,
    randomDelay
};
