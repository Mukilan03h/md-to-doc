const { exportDocx } = require('../src/exportDocx');
const { exportPdf } = require('../src/exportPdf');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

jest.mock('marked', () => ({
  marked: {
    lexer: jest.fn().mockReturnValue([
      { type: 'heading', depth: 1, text: 'Hello World' },
      { type: 'paragraph', tokens: [
          { type: 'text', text: 'This is a ' },
          { type: 'strong', tokens: [{ type: 'text', text: 'test' }] },
          { type: 'text', text: ' paragraph.' }
      ]}
    ])
  }
}));

describe('Export Functions', () => {
  const testDir = path.join(__dirname, 'test-output');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('exportDocx creates a valid docx file', async () => {
    const markdown = `# Hello World
This is a **test** paragraph.`;
    const outputPath = path.join(testDir, 'test.docx');

    await exportDocx(markdown, outputPath, testDir, { title: 'Test Doc' });

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('exportPdf creates a valid pdf file', async () => {
    const html = '<h1>Hello World</h1><p>This is a test.</p>';
    const outputPath = path.join(testDir, 'test.pdf');
    const executablePath = puppeteer.executablePath();

    await exportPdf(html, outputPath, 'default', 'A4', executablePath);

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 15000); // increase timeout
});
