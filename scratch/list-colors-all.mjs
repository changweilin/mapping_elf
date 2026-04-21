import fs from 'fs';
import path from 'path';

const files = ['public/favicon.svg', 'public/simple_owl_cursor.svg', 'public/mapping_owl_cursor.svg'];

files.forEach(f => {
    if (!fs.existsSync(f)) return;
    const content = fs.readFileSync(f, 'utf8');
    const colors = new Set();
    const matches = content.matchAll(/(fill|stroke)="(#[0-9a-fA-F]{6})"/g);
    for (const match of matches) {
        colors.add(match[2].toUpperCase());
    }
    console.log(`${f}: ${JSON.stringify(Array.from(colors).sort())}`);
});
