import fs from 'fs';

const content = fs.readFileSync('public/mapping_owl_cursor.svg', 'utf8');
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

const pathRegex = /<path([^>]+)>/g;
let match;
const allPaths = [];
while ((match = pathRegex.exec(content)) !== null) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    if (fillMatch && dMatch) {
        const bbox = getBoundingBox(dMatch[1]);
        allPaths.push({ color: fillMatch[1].toUpperCase(), bbox });
    }
}

// Focus on the left side (X < 1152) and see what's there
console.log("Left side paths (X < 1150):");
allPaths.filter(p => p.bbox.minX < 1150).forEach(p => {
    const r = parseInt(p.color.slice(1,3), 16);
    const g = parseInt(p.color.slice(3,5), 16);
    const b = parseInt(p.color.slice(5,7), 16);
    const avg = (r+g+b)/3;
    const diff = Math.max(r,g,b) - Math.min(r,g,b);
    console.log(`${p.color}: bbox=[${p.bbox.minX.toFixed(0)},${p.bbox.minY.toFixed(0)}] to [${p.bbox.maxX.toFixed(0)},${p.bbox.maxY.toFixed(0)}], avg=${avg.toFixed(1)}, diff=${diff}`);
});
