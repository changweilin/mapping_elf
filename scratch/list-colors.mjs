import fs from 'fs';
const content = fs.readFileSync('public/mapping_owl_cursor.svg', 'utf8');
const colors = new Set();
const matches = content.matchAll(/(fill|stroke)="(#[0-9a-fA-F]{6})"/g);
for (const match of matches) {
    colors.add(match[2].toUpperCase());
}
console.log(JSON.stringify(Array.from(colors).sort()));
