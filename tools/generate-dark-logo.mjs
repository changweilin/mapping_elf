/**
 * Dark Mode Logo Generator for Mapping Elf
 * 
 * Usage: node tools/generate-dark-logo.mjs
 */

import fs from 'fs/promises';
import path from 'path';

const root = path.resolve(process.cwd());

// Dark Mode Palette
const OWL_BODY_COLOR_DARK = "#A5C9FF"; // Pinkish sky blue

async function generateDarkSvg(inputPath, outputPath) {
  const content = await fs.readFile(inputPath, 'utf8');

  const processed = content.replace(/<path([^>]+)>/g, (m, attrs) => {
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const strokeMatch = attrs.match(/stroke="(#[0-9a-fA-F]{6})"/);

    let tag = m;

    if (fillMatch) {
      const hex = fillMatch[1].toUpperCase();
      if (hex.startsWith("#2") || hex.startsWith("#30")) { 
        // Catch dark blue/grey shades for the body
        tag = tag.replace(/fill="(#[0-9a-fA-F]{6})"/, `fill="${OWL_BODY_COLOR_DARK}"`);
      }
    }

    if (strokeMatch) {
      const hex = strokeMatch[1].toUpperCase();
      if (hex.startsWith("#2") || hex.startsWith("#30")) {
        tag = tag.replace(/stroke="(#[0-9a-fA-F]{6})"/, `stroke="${OWL_BODY_COLOR_DARK}"`);
      }
    }

    return tag;
  });

  await fs.writeFile(outputPath, processed);
  console.log(`Generated ${path.relative(root, outputPath)}`);
}

const tasks = [
  { in: 'public/mapping_owl_cursor.svg', out: 'public/mapping_owl_cursor_dark.svg' },
  { in: 'public/simple_owl_cursor.svg', out: 'public/simple_owl_cursor_dark.svg' },
  { in: 'public/favicon.svg', out: 'public/favicon_dark.svg' },
  { in: 'data/mapping_owl_cursor.svg', out: 'data/mapping_owl_cursor_dark.svg' },
  { in: 'data/simple_owl_cursor.svg', out: 'data/simple_owl_cursor_dark.svg' },
];

for (const t of tasks) {
  const inPath = path.join(root, t.in);
  const outPath = path.join(root, t.out);
  try {
    await generateDarkSvg(inPath, outPath);
  } catch (err) {
    console.error(`Failed to process ${t.in}: ${err.message}`);
  }
}
