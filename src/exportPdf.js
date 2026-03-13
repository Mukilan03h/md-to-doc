const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function exportPdf(html, outputPath, theme, pageSize, electronAppPath, fontSize = '16px', margins = '20mm', frontmatter = {}, basePath = '') {
  // Use user-selected theme or default
  const themePath = path.join(__dirname, 'themes', `${theme}.css`);
  let themeCss = '';
  if (fs.existsSync(themePath)) {
    themeCss = fs.readFileSync(themePath, 'utf-8');
  }

  let coverBlock = '';
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    coverBlock = '<div class="pdf-cover" style="page-break-after: always; display: flex; flex-direction: column; justify-content: center; height: 100vh;">';
    if (frontmatter.title) coverBlock += `<h1 style="text-align: center; font-size: 3em; margin-bottom: 0.5em;">${frontmatter.title}</h1>`;
    if (frontmatter.author) coverBlock += `<h2 style="text-align: center; font-size: 1.5em; font-weight: normal; margin-bottom: 0.5em;">${frontmatter.author}</h2>`;
    if (frontmatter.date) coverBlock += `<p style="text-align: center; font-size: 1.2em; color: #666;">${frontmatter.date}</p>`;
    if (frontmatter.abstract) coverBlock += `<div style="margin-top: 2em; padding: 0 20%; text-align: justify;"><p><strong>Abstract:</strong> ${frontmatter.abstract}</p></div>`;
    coverBlock += '</div>';
  }

  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        ${basePath ? `<base href="file://${basePath}/">` : ''}
        <style>
          ${themeCss}
          body { font-size: ${fontSize}; }
        </style>
      </head>
      <body>
        ${coverBlock}
        ${html}
      </body>
    </html>
  `;

  // We need puppeteer-core to launch electron's bundled chromium
  // Let the caller (main.js) pass the executable path
  // Electron path could be tricky, usually app.getPath('exe') is passed from main process
  const browser = await puppeteer.launch({
    executablePath: electronAppPath,
    headless: "new", // use new headless mode
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

  await page.pdf({
    path: outputPath,
    format: pageSize,
    printBackground: true,
    margin: {
      top: margins,
      right: margins,
      bottom: margins,
      left: margins
    }
  });

  await browser.close();
  return outputPath;
}

module.exports = { exportPdf };
