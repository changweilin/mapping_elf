import fs from 'fs';
import path from 'path';

const svgPath = 'public/mapping_owl_cursor.svg';
const content = fs.readFileSync(svgPath, 'utf8');

function getBoundingBox(d) {
    const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (!coords) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i += 2) {
        const x = parseFloat(coords[i]);
        const y = parseFloat(coords[i+1]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
}

const pathRegex = /<path[^>]+fill="(#[0-9a-fA-F]{6})"[^>]+d="([^"]+)"/g;
let match;
const analysis = [];

while ((match = pathRegex.exec(content)) !== null) {
    const color = match[1].toUpperCase();
    const d = match[2];
    const bbox = getBoundingBox(d);
    if (bbox) {
        analysis.push({ color, bbox });
    }
}

// Group by color and find total extent
const colorGroups = {};
analysis.forEach(item => {
    if (!colorGroups[item.color]) {
        colorGroups[item.color] = {
            count: 0,
            area: 0,
            minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity
        };
    }
    colorGroups[item.color].count++;
    const w = item.bbox.maxX - item.bbox.minX;
    const h = item.bbox.maxY - item.bbox.minY;
    colorGroups[item.color].area += w * h;
    if (item.bbox.minX < colorGroups[item.color].minX) colorGroups[item.color].minX = item.bbox.minX;
    if (item.bbox.minY < colorGroups[item.color].minY) colorGroups[item.color].minY = item.bbox.minY;
    if (item.bbox.maxX > colorGroups[item.color].maxX) colorGroups[item.color].maxX = item.bbox.maxX;
    if (item.bbox.maxY > colorGroups[item.color].maxY) colorGroups[item.color].maxY = item.bbox.maxY;
});

console.log(JSON.stringify(colorGroups, null, 2));

// Also find small "spots" - paths with small area
const spots = analysis.filter(item => {
    const w = item.bbox.maxX - item.bbox.minX;
    const h = item.bbox.maxY - item.bbox.minY;
    return (w * h) < 10000; // threshold for spots
});

console.log("\nSmall Spots Sample:");
console.log(JSON.stringify(spots.slice(0, 10), null, 2));
