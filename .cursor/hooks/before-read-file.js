#!/usr/bin/env node
const { readStdin } = require('./adapter');

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\.(development|test|production|staging)(\.local)?$/,
  /^\.env\.example$/,
  /^\.env\.local\.example$/,
  /^\.env\.template$/,
  /^(credentials|secrets|service-account|service_account)\.(json|yaml|yml|pem|key|p12)$/,
  /\.(pem|p12|pfx|key)$/,
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/,
  /^\.(npmrc|pypirc|netrc|curlrc|aws|terraformrc)$/,
  /^kubeconfig$/,
  /^credentials\.json$/,
  /^client_secret/,
];

const SENSITIVE_DIR_PATTERNS = [
  /\/secrets\//,
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /\/\.aws\//,
  /\/credentials\//,
];

function isSensitive(filePath) {
  if (!filePath) return false;

  const basename = filePath.split('/').pop();
  const lowerPath = filePath.toLowerCase();

  for (const pat of SENSITIVE_BASENAME_PATTERNS) {
    if (pat.test(basename)) return { name: basename };
  }

  for (const pat of SENSITIVE_DIR_PATTERNS) {
    if (pat.test(lowerPath)) return { name: 'sensitive directory' };
  }

  return null;
}

readStdin().then(raw => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}

  const filePath = input.path || input.file || '';
  const match = isSensitive(filePath);

  if (match) {
    const response = {
      permission: 'deny',
      user_message: `Blocked: reading ${match.name} is not allowed to protect secrets.`,
      agent_message: `A hook blocked reading "${filePath}". This file likely contains secrets, credentials, or sensitive configuration. Do not attempt to read .env files, .env.example files, credential files, private keys, or any other sensitive files.`,
    };
    process.stdout.write(JSON.stringify(response));
    process.exit(0);
  }

  // Allow non-sensitive files through
  const output = { permission: 'allow' };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}).catch(() => {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
});
