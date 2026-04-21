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

// Regex to find paths and their fills
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

// Define "Pale colors"
function isPale(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    // Looking for colors like #CAB8AA, #C5B1A4, #D4B58E
    // These have high average (160+) and low saturation (max-min < 60)
    return (max - min) <= 60 && avg >= 150;
}

const palePaths = results.filter(p => isPale(p.color));

console.log(`Total paths: ${results.length}`);
console.log(`Pale paths: ${palePaths.length}`);

// Group pale paths by region
// viewBox="0 0 2304 1838"
const regions = {
    top: palePaths.filter(p => p.bbox.maxY < 500),
    topMiddle: palePaths.filter(p => p.bbox.maxY < 500 && p.bbox.minX > 800 && p.bbox.maxX < 1500),
    leftWing: palePaths.filter(p => p.bbox.minX < 800),
    rightWing: palePaths.filter(p => p.bbox.maxX > 1500),
};

Object.keys(regions).forEach(name => {
    console.log(`\nRegion ${name}: ${regions[name].length} paths`);
    if (regions[name].length > 0) {
        const colors = new Set(regions[name].map(p => p.color));
        console.log(`  Colors: ${Array.from(colors).join(', ')}`);
        // Find total extent
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        regions[name].forEach(p => {
            minX = Math.min(minX, p.bbox.minX);
            minY = Math.min(minY, p.bbox.minY);
            maxX = Math.max(maxX, p.bbox.maxX);
            maxY = Math.max(maxY, p.bbox.maxY);
        });
        console.log(`  Extent: [${minX.toFixed(0)}, ${minY.toFixed(0)}] to [${maxX.toFixed(0)}, ${maxY.toFixed(0)}]`);
    }
});

// Output all pale paths for mapping
// console.log(JSON.stringify(palePaths, null, 2));
