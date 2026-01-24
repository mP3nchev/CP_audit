#!/usr/bin/env node
/**
 * DEBUG VERSION - Takes screenshot before pause
 */

const puppeteer = require('puppeteer');
const readline = require('readline');
const fs = require('fs').promises;

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');

if (urlIndex === -1 || !args[urlIndex + 1]) {
  console.error('❌ Error: --url parameter required');
  console.log('Usage: node manual-consent-audit-debug.js --url https://example.com');
  process.exit(1);
}

const WEBSITE_URL = args[urlIndex + 1];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  let browser;

  try {
    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized']
    });

    const page = await browser.newPage();

    console.log(`📡 Navigating to ${WEBSITE_URL}...`);
    await page.goto(WEBSITE_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    console.log('✅ Page loaded');

    console.log('⏳ Waiting 5 seconds for UI to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take screenshot BEFORE pause
    const screenshot = await page.screenshot({ fullPage: false });
    await fs.writeFile('debug-screenshot-before-pause.png', screenshot);
    console.log('📸 Screenshot saved: debug-screenshot-before-pause.png');

    console.log('');
    console.log('⏸️  PAUSE: Check the Chrome window');
    console.log('');
    console.log('🔍 Open debug-screenshot-before-pause.png to see what page looks like');
    console.log('');
    await askQuestion('Press ENTER to continue... ');

    console.log('✅ Done! Check the screenshot to see if banner is visible.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
    rl.close();
  }
}

main();
