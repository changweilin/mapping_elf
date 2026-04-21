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
while ((match = pathRegex.exec(content)) !== null) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    if (fillMatch && dMatch) {
        const color = fillMatch[1].toUpperCase();
        const bbox = getBoundingBox(dMatch[1]);
        // Focus on the transition area between wing and hills
        if (bbox.minX < 1150 && bbox.maxY > 800 && bbox.minY < 1400) {
            console.log(`${color}: bbox=[${bbox.minX.toFixed(1)},${bbox.minY.toFixed(1)}] to [${bbox.maxX.toFixed(1)},${bbox.maxY.toFixed(1)}]`);
        }
    }
}
