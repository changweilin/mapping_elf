import fs from 'fs';
const content = fs.readFileSync('public/favicon.svg', 'utf8');
const matches = content.match(/#[0-9a-fA-F]{6}/g);
console.log(JSON.stringify(Array.from(new Set(matches)).sort()));
