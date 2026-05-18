import fs from 'node:fs';

const packageFile = 'ios/App/CapApp-SPM/Package.swift';

if (!fs.existsSync(packageFile)) {
  process.exit(0);
}

const source = fs.readFileSync(packageFile, 'utf8');
const normalized = source.replaceAll(
  '..\\..\\..\\node_modules\\@capacitor\\',
  '../../../node_modules/@capacitor/',
);

if (normalized !== source) {
  fs.writeFileSync(packageFile, normalized);
  console.log('Normalized Capacitor Swift Package paths');
}
