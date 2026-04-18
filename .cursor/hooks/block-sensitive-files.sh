#!/bin/bash
# Block reading of sensitive/confidential files.
# Hook event: beforeReadFile
# Input JSON on stdin, e.g.: {"path": "/abs/path/.env.local"}
# Exit 0 with permission deny to block, exit 0 with permission allow to pass.

input=$(cat)
file_path=$(echo "$input" | jq -r '.path // empty')

if [ -z "$file_path" ]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

# Extract the basename for pattern matching
basename=$(basename "$file_path")

# --- Sensitive file patterns ---
# Environment files
if [[ "$basename" =~ ^\.env$ ]] || \
   [[ "$basename" =~ ^\.env\.local$ ]] || \
   [[ "$basename" =~ ^\.env\.(development|test|production|staging)(\.local)?$ ]] || \
   [[ "$basename" =~ ^\.env\.example$ ]] || \
   [[ "$basename" =~ ^\.env\.local\.example$ ]] || \
   [[ "$basename" =~ ^\.env\.template$ ]]; then
  echo '{
    "permission": "deny",
    "user_message": "Blocked: reading environment file '"$basename"' is not allowed to protect secrets.",
    "agent_message": "A hook blocked reading '"$basename"'. This file likely contains secrets or sensitive configuration. Do not attempt to read .env files, .env.example files, or any other environment configuration files."
  }'
  exit 0
fi

# Credentials / keys / secrets files
if [[ "$basename" =~ ^(credentials|secrets|service-account|service_account)\.(json|yaml|yml|pem|key|p12)$ ]] || \
   [[ "$basename" =~ \.(pem|p12|pfx|key)$ ]] || \
   [[ "$basename" =~ ^id_(rsa|ed25519|ecdsa|dsa)$ ]] || \
   [[ "$basename" =~ ^id_(rsa|ed25519|ecdsa|dsa)\.pub$ ]] || \
   [[ "$basename" =~ ^\.(npmrc|pypirc|netrc|curlrc|aws|terraformrc)$ ]] || \
   [[ "$basename" =~ ^kubeconfig$ ]] || \
   [[ "$basename" =~ ^\.kube/config$ ]] || \
   [[ "$basename" =~ ^credentials\.json$ ]] || \
   [[ "$basename" =~ ^client_secret ]]; then
  echo '{
    "permission": "deny",
    "user_message": "Blocked: reading credentials/key file '"$basename"' is not allowed.",
    "agent_message": "A hook blocked reading '"$basename"'. This file likely contains credentials, private keys, or secrets. Do not attempt to read credential or key files."
  }'
  exit 0
fi

# Match any path segment containing sensitive directories
lower_path=$(echo "$file_path" | tr '[:upper:]' '[:lower:]')
if [[ "$lower_path" =~ /secrets/ ]] || \
   [[ "$lower_path" =~ /\.ssh/ ]] || \
   [[ "$lower_path" =~ /\.gnupg/ ]] || \
   [[ "$lower_path" =~ /\.aws/ ]] || \
   [[ "$lower_path" =~ /credentials/ ]]; then
  echo '{
    "permission": "deny",
    "user_message": "Blocked: path contains a sensitive directory.",
    "agent_message": "A hook blocked reading a file in a sensitive directory (secrets, .ssh, .gnupg, .aws, or credentials). Do not attempt to read files from these locations."
  }'
  exit 0
fi

echo '{ "permission": "allow" }'
exit 0
