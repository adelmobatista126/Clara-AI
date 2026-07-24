#!/data/data/com.termux/files/usr/bin/bash
# Deploy do painel Clara na Netlify (metodo digest)
set -e
cd ~/Clara-AI/dashboard
SITE="d447a1b9-0940-4403-8c87-e218c4827e1b"
TOKEN=$(cat ~/.netlify_token)
SHA=$(sha1sum index.html | cut -d' ' -f1)

echo "Criando deploy..."
RESP=$(curl -s -X POST "https://api.netlify.com/api/v1/sites/$SITE/deploys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"files\":{\"/index.html\":\"$SHA\"}}")

DEPLOY_ID=$(printf '%s' "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$DEPLOY_ID" ]; then
  echo "ERRO: nao consegui criar o deploy. Resposta:"
  printf '%s\n' "$RESP" | head -c 300
  exit 1
fi

echo "Deploy $DEPLOY_ID - enviando arquivo..."
curl -s -X PUT "https://api.netlify.com/api/v1/deploys/$DEPLOY_ID/files/index.html" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@index.html" > /dev/null

echo "OK! Deploy enviado. Confira em ~30s: https://painel-clara.netlify.app"
