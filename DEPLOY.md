# Guia de Deploy - Inventario Inteligente

Deploy em 5 passos no Databricks.

---

## Pre-requisitos

- Databricks CLI v0.250+ ([instalar](https://docs.databricks.com/dev-tools/cli/install.html))
- Node.js 18+ ([instalar](https://nodejs.org/))
- Git

---

## Passo 1 - Clonar e buildar

```bash
git clone https://github.com/juliandrof/inventario-inteligente.git
cd inventario-inteligente

# Build do frontend
cd frontend && npm install && npm run build && cd ..
```

---

## Passo 2 - Autenticar no workspace

```bash
databricks auth login https://SEU-WORKSPACE.cloud.databricks.com --profile meu-workspace
```

Siga o fluxo SSO no navegador. Teste com:

```bash
databricks auth profiles
# Deve mostrar "meu-workspace" com status YES
```

---

## Passo 3 - Criar infraestrutura

### 3a. Lakebase (banco de dados)

```bash
databricks postgres create-project \
  --json '{"display_name": "inventario-inteligente"}' \
  --profile meu-workspace
```

Anote o **host** do endpoint que sera criado:

```bash
databricks postgres list-endpoints \
  "projects/inventario-inteligente/branches/production" \
  --profile meu-workspace -o json
```

O host tera formato: `ep-xxxxx.database.REGIAO.cloud.databricks.com`

### 3b. Unity Catalog (volumes para videos e thumbnails)

```bash
# Criar catalog (ou use um existente)
databricks schemas create inventario_inteligente SEU_CATALOG --profile meu-workspace

# Criar volumes
databricks volumes create SEU_CATALOG inventario_inteligente uploaded_videos MANAGED --profile meu-workspace
databricks volumes create SEU_CATALOG inventario_inteligente thumbnails MANAGED --profile meu-workspace
```

### 3c. Databricks App

```bash
databricks apps create inventario-inteligente \
  --json '{"description": "Inventario Inteligente de Expositores"}' \
  --profile meu-workspace
```

Anote o **service_principal_client_id** da saida (ex: `9f451c92-...`).

### 3d. Permissoes do Service Principal

```bash
# Acesso ao catalog e volumes
databricks grants update catalog SEU_CATALOG \
  --json '{"changes":[{"principal":"SERVICE_PRINCIPAL_ID","add":["USE_CATALOG","USE_SCHEMA"]}]}' \
  --profile meu-workspace

databricks grants update schema SEU_CATALOG.inventario_inteligente \
  --json '{"changes":[{"principal":"SERVICE_PRINCIPAL_ID","add":["USE_SCHEMA","READ_VOLUME","WRITE_VOLUME"]}]}' \
  --profile meu-workspace
```

Para o Lakebase, conecte com seu usuario e crie o role do SP:

```bash
# Gerar seu token
databricks postgres generate-database-credential \
  "projects/inventario-inteligente/branches/production/endpoints/primary" \
  --profile meu-workspace -o json

# Conectar via psql (use o token como senha)
PGPASSWORD="TOKEN_AQUI" psql \
  -h ep-xxxxx.database.REGIAO.cloud.databricks.com \
  -U seu.email@empresa.com -d postgres --set=sslmode=require

# No psql, execute:
CREATE ROLE "SERVICE_PRINCIPAL_ID" LOGIN CREATEDB;
ALTER ROLE "SERVICE_PRINCIPAL_ID" WITH PASSWORD 'SENHA_SEGURA_AQUI';
CREATE DATABASE inventario_inteligente;
GRANT ALL ON DATABASE inventario_inteligente TO "SERVICE_PRINCIPAL_ID";
\c inventario_inteligente
GRANT ALL ON SCHEMA public TO "SERVICE_PRINCIPAL_ID";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "SERVICE_PRINCIPAL_ID";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "SERVICE_PRINCIPAL_ID";
\q
```

---

## Passo 4 - Configurar app.yaml

Edite `app.yaml` com seus valores:

```yaml
command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "8000"
env:
  - name: DBXSC_AI_DB_HOST
    value: "ep-xxxxx.database.REGIAO.cloud.databricks.com"  # seu endpoint
  - name: DBXSC_AI_DB_PORT
    value: "5432"
  - name: DBXSC_AI_DB_NAME
    value: "inventario_inteligente"
  - name: DBXSC_AI_DB_USER
    value: "SERVICE_PRINCIPAL_ID"                            # client_id do SP
  - name: DBXSC_AI_DB_PASSWORD
    value: "SENHA_DO_PASSO_3D"                               # senha criada no psql
  - name: DBXSC_AI_LAKEBASE_PROJECT
    value: "inventario-inteligente"
  - name: DBXSC_AI_LAKEBASE_BRANCH
    value: "production"
  - name: DBXSC_AI_LAKEBASE_ENDPOINT
    value: "primary"
  - name: FMAPI_MODEL
    value: "databricks-llama-4-maverick"                     # ou seu modelo custom
  - name: VIDEO_VOLUME
    value: "/Volumes/SEU_CATALOG/inventario_inteligente/uploaded_videos"
  - name: THUMBNAIL_VOLUME
    value: "/Volumes/SEU_CATALOG/inventario_inteligente/thumbnails"
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: databricks-llama-4-maverick
      permission: CAN_QUERY
```

---

## Passo 5 - Deploy

```bash
# Subir codigo para o workspace
databricks workspace import-dir . \
  /Workspace/Users/SEU_EMAIL/inventario-inteligente-source \
  --profile meu-workspace --overwrite \
  --exclude-dirs .git,node_modules,__pycache__,.databricks

# Deployar o app
databricks apps deploy inventario-inteligente \
  --source-code-path /Workspace/Users/SEU_EMAIL/inventario-inteligente-source \
  --profile meu-workspace
```

Aguarde a mensagem `"App started successfully"`. Acesse a URL mostrada no output.

---

## Atualizando

Para atualizar apos mudancas no codigo:

```bash
cd frontend && npm run build && cd ..

databricks workspace import-dir . \
  /Workspace/Users/SEU_EMAIL/inventario-inteligente-source \
  --profile meu-workspace --overwrite \
  --exclude-dirs .git,node_modules,__pycache__,.databricks

databricks apps deploy inventario-inteligente \
  --source-code-path /Workspace/Users/SEU_EMAIL/inventario-inteligente-source \
  --profile meu-workspace
```

---

## Troubleshooting

### Ver logs do app
```bash
databricks apps logs inventario-inteligente --profile meu-workspace
```

### Erro de conexao com Lakebase
Verifique se o `DBXSC_AI_DB_HOST`, `DBXSC_AI_DB_USER` e `DBXSC_AI_DB_PASSWORD` estao corretos no `app.yaml`. O app cria as tabelas automaticamente no primeiro boot.

### Erro de permissao no Volume
Verifique se o service principal tem `READ_VOLUME` e `WRITE_VOLUME` no schema.

### Modelo nao responde
Verifique se o serving endpoint esta ativo e se o SP tem `CAN_QUERY` (configurado na secao `resources` do `app.yaml`).
