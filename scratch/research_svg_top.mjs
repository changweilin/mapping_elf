import fs from 'fs';
import path from 'path';

const svgPath = 'public/mapping_owl_cursor.svg';
const content = fs.readFileSync(svgPath, 'utf8');

function getBoundingBox(d) {
    const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (!coords) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i += 2) {
        if (coords[i] === undefined || coords[i+1] === undefined) break;
        const x = parseFloat(coords[i]);
        const y = parseFloat(coords[i+1]);
        if (isNaN(x) || isNaN(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
}

const pathRegex = /<path([^>]+)>/g;
let match;
const results = [];

while ((match = pathRegex.exec(content)) !== null) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    
    if (fillMatch && dMatch) {
        const color = fillMatch[1].toUpperCase();
        const bbox = getBoundingBox(dMatch[1]);
        if (bbox) {
            results.push({ color, bbox });
        }
    }
}

// Find colors in Top Middle region
const topMiddleRegion = results.filter(p => p.bbox.maxY < 500 && p.bbox.minX > 600 && p.bbox.maxX < 1700);

console.log(`Paths in Top Middle: ${topMiddleRegion.length}`);
const topMiddleColors = {};
topMiddleRegion.forEach(p => {
    if (!topMiddleColors[p.color]) {
        topMiddleColors[p.color] = { count: 0, bboxes: [] };
    }
    topMiddleColors[p.color].count++;
    topMiddleColors[p.color].bboxes.push(p.bbox);
});

Object.keys(topMiddleColors).forEach(color => {
    const data = topMiddleColors[color];
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const avg = (r + g + b) / 3;
    console.log(`${color}: count=${data.count}, avg=${avg.toFixed(1)}`);
});
