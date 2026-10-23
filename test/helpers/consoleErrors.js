const EXPECTED_EXTERNAL_RESOURCE_ERROR_PARTS = [
  'net::ERR_NETWORK_ACCESS_DENIED',
  'net::ERR_NO_BUFFER_SPACE',
  'the server responded with a status of 404 (Offline)',
  'the server responded with a status of 429',
  'the server responded with a status of 502',
  'the server responded with a status of 503',
  'the server responded with a status of 504',
];

export function isExpectedExternalResourceNoise(text) {
  return text.includes('Failed to load resource')
    && EXPECTED_EXTERNAL_RESOURCE_ERROR_PARTS.some((part) => text.includes(part));
}

export function collectUnexpectedConsoleErrors(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isExpectedExternalResourceNoise(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  return consoleErrors;
}
