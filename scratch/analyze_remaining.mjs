import fs from 'fs';
import path from 'path';

const svgPath = 'public/mapping_owl_cursor.svg';
const content = fs.readFileSync(svgPath, 'utf8');

function getBoundingBox(d) {
    const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (!coords) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i += 2) {
        if (coords[i+1] === undefined) break;
        const x = parseFloat(coords[i]);
        const y = parseFloat(coords[i+1]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, centerX: (minX+maxX)/2, centerY: (minY+maxY)/2 };
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
        if (bbox) results.push({ color, bbox, tag: match[0] });
    }
}

// Find colors with high counts or specific hues
const colorSummary = {};
results.forEach(p => {
    if (!colorSummary[p.color]) colorSummary[p.color] = { count: 0, bboxes: [] };
    colorSummary[p.color].count++;
    colorSummary[p.color].bboxes.push(p.bbox);
});

console.log("Color Distribution:");
Object.keys(colorSummary).sort((a,b) => colorSummary[b].count - colorSummary[a].count).forEach(c => {
    const data = colorSummary[c];
    let minX = Math.min(...data.bboxes.map(b => b.minX));
    let maxX = Math.max(...data.bboxes.map(b => b.maxX));
    let minY = Math.min(...data.bboxes.map(b => b.minY));
    let maxY = Math.max(...data.bboxes.map(b => b.maxY));
    console.log(`${c}: count=${data.count}, extent=[${minX.toFixed(0)}, ${minY.toFixed(0)}] to [${maxX.toFixed(0)}, ${maxY.toFixed(0)}]`);
});

// Analyze "Pale" paths that are still there (if any)
function isPale(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    return (max - min) <= 60 && avg >= 140;
}

const remainingPale = results.filter(p => isPale(p.color));
console.log("\nRemaining Pale Paths:");
remainingPale.forEach(p => {
    console.log(`Color: ${p.color}, Center: [${p.bbox.centerX.toFixed(0)}, ${p.bbox.centerY.toFixed(0)}], BBox: [${p.bbox.minX.toFixed(0)}, ${p.bbox.minY.toFixed(0)}] to [${p.bbox.maxX.toFixed(0)}, ${p.bbox.maxY.toFixed(0)}]`);
});
