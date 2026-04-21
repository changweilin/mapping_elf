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
        const hex = fillMatch[1].toUpperCase();
        if (['#C0956A', '#BEA07F', '#D4B58E'].includes(hex)) {
            const bbox = getBoundingBox(dMatch[1]);
            if (bbox.minY > 1200) console.log('MAP BASE:', hex, JSON.stringify(bbox));
        }
    }
}
