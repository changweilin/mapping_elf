import fs from 'fs';
import path from 'path';
import { getBoundingBox } from './svg-utils.mjs';

const filePath = 'public/mapping_owl_cursor.svg';
const content = fs.readFileSync(filePath, 'utf8');

const targetColors = ['#2E3658', '#D7B181', '#C0956A'];

const colorStats = {};

const matches = content.matchAll(/<path([^>]+)>/g);
for (const match of matches) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const strokeMatch = attrs.match(/stroke="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);

    const check = (hex) => {
        if (!hex) return;
        const upper = hex.toUpperCase();
        if (!targetColors.includes(upper)) {
            const bbox = getBoundingBox(dMatch ? dMatch[1] : "");
            if (!colorStats[upper]) colorStats[upper] = [];
            colorStats[upper].push({ bbox });
        }
    };

    if (fillMatch) check(fillMatch[1]);
    if (strokeMatch) check(strokeMatch[1]);
}

console.log(JSON.stringify(colorStats, null, 2));
