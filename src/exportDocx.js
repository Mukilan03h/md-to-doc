const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ImageRun, AlignmentType, BorderStyle } = require('docx');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Base64 helper for images
async function fetchImageAsBase64(imagePath, basePath) {
  try {
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const response = await fetch(imagePath);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer;
    } else {
      const fullPath = path.resolve(basePath, imagePath);
      return fs.readFileSync(fullPath);
    }
  } catch (error) {
    console.error(`Failed to load image: ${imagePath}`, error);
    return null;
  }
}

// Convert marked tokens to DOCX elements
async function renderTokens(tokens, basePath, listLevel = 0, isOrdered = false) {
  let elements = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const headingLevels = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6
        ];
        elements.push(new Paragraph({
          text: token.text,
          heading: headingLevels[Math.min(token.depth - 1, 5)]
        }));
        break;
      }

      case 'paragraph': {
        const runs = await renderInlineTokens(token.tokens || [], basePath);
        elements.push(new Paragraph({
          children: runs
        }));
        break;
      }

      case 'list': {
        for (const item of token.items) {
          const itemRuns = await renderInlineTokens(item.tokens[0]?.type === 'text' ? item.tokens[0].tokens : [], basePath);
          elements.push(new Paragraph({
            children: itemRuns,
            numbering: {
              reference: token.ordered ? 'ordered' : 'unordered',
              level: listLevel
            }
          }));

          // Handle nested lists or block elements inside list items
          if (item.tokens.length > 1) {
            const nestedTokens = item.tokens.slice(1);
            const nestedElements = await renderTokens(nestedTokens, basePath, listLevel + 1, token.ordered);
            elements.push(...nestedElements);
          }
        }
        break;
      }

      case 'blockquote': {
        const blockquoteRuns = [];
        for (const child of token.tokens) {
          if (child.type === 'paragraph') {
            const runs = await renderInlineTokens(child.tokens || [], basePath);
            blockquoteRuns.push(...runs);
          }
        }
        elements.push(new Paragraph({
          children: blockquoteRuns,
          indent: { left: 720 }, // Indent for blockquote
          borders: {
            left: { style: BorderStyle.SINGLE, size: 24, color: "CCCCCC", space: 10 }
          }
        }));
        break;
      }

      case 'code': {
        elements.push(new Paragraph({
          children: [new TextRun({ text: token.text, font: "Courier New" })],
          shading: { fill: "F0F0F0" }
        }));
        break;
      }

      case 'table': {
        const rows = [];

        // Header
        const headerCells = await Promise.all(token.header.map(async (cell) => {
          const runs = await renderInlineTokens(cell.tokens || [], basePath);
          return new TableCell({
            children: [new Paragraph({ children: runs })],
            shading: { fill: "E0E0E0" }
          });
        }));
        rows.push(new TableRow({ children: headerCells }));

        // Rows
        for (const row of token.rows) {
          const cells = await Promise.all(row.map(async (cell) => {
            const runs = await renderInlineTokens(cell.tokens || [], basePath);
            return new TableCell({
              children: [new Paragraph({ children: runs })]
            });
          }));
          rows.push(new TableRow({ children: cells }));
        }

        elements.push(new Table({ rows }));
        break;
      }

      case 'space':
        break;

      default:
        console.warn(`Unhandled block token type: ${token.type}`);
        break;
    }
  }

  return elements;
}

async function renderInlineTokens(tokens, basePath, inheritedOptions = {}) {
  const runs = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
        runs.push(new TextRun({ text: token.text, ...inheritedOptions }));
        break;

      case 'strong':
        runs.push(...(await renderInlineTokens(token.tokens, basePath, { ...inheritedOptions, bold: true })));
        break;

      case 'em':
        runs.push(...(await renderInlineTokens(token.tokens, basePath, { ...inheritedOptions, italics: true })));
        break;

      case 'codespan':
        runs.push(new TextRun({ text: token.text, font: "Courier New", highlight: "lightGray", ...inheritedOptions }));
        break;

      case 'image': {
        const imageBuffer = await fetchImageAsBase64(token.href, basePath);
        if (imageBuffer) {
          runs.push(new ImageRun({
            data: imageBuffer,
            transformation: { width: 400, height: 300 } // Basic sizing for now
          }));
        } else {
          runs.push(new TextRun({ text: `[image: ${token.text || path.basename(token.href)}]`, italics: true, color: "FF0000" }));
        }
        break;
      }

      case 'link': {
        const linkText = token.tokens && token.tokens.length > 0 ? token.tokens[0].text : token.text;
        runs.push(new TextRun({ text: `${linkText} (${token.href})`, color: "0000FF", underline: {}, ...inheritedOptions }));
        break;
      }

      default:
        console.warn(`Unhandled inline token type: ${token.type}`);
        runs.push(new TextRun({ text: token.raw, ...inheritedOptions }));
        break;
    }
  }

  return runs;
}

async function exportDocx(markdown, outputPath, basePath, frontmatter = {}) {
  const tokens = marked.lexer(markdown);

  const children = await renderTokens(tokens, basePath);

  // Create document
  const doc = new Document({
    creator: frontmatter.author || "MDForge",
    title: frontmatter.title || path.basename(outputPath, '.docx'),
    description: frontmatter.abstract || "",
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [
            { level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: "lowerLetter", text: "%2.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
          ]
        },
        {
          reference: "unordered",
          levels: [
            { level: 0, format: "bullet", text: "•", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: "bullet", text: "o", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
          ]
        }
      ]
    },
    sections: [{
      properties: {},
      children: children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = { exportDocx };
