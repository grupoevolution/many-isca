# iscalab

Sistema de iscas digitais com painel admin.

## Rotas

| Rota | Descrição |
|------|-----------|
| `/` | Página inicial |
| `/:slug` | Página pública gerada |
| `/admin` | Painel (PIN: 8203) |
| `/admin/leads` | Leads capturados |

## Deploy no EasyPanel

### Opção 1 — Via GitHub (recomendado)

1. Suba este projeto para um repositório GitHub
2. No EasyPanel: **+ Create App → GitHub**
3. Selecione o repositório
4. Em **Environment Variables**, adicione:
   ```
   PORT=3000
   ADMIN_PIN=8203
   ```
5. Em **Volumes**, adicione dois mounts persistentes:
   - `/app/db` → para o banco de dados
   - `/app/uploads` → para as imagens
6. Expor porta `3000`
7. Deploy!

### Opção 2 — Docker Compose

```bash
docker-compose up -d
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | 3000 | Porta da aplicação |
| `ADMIN_PIN` | 8203 | PIN de acesso ao admin |

## Estrutura

```
isca-lab/
├── server.js        # Servidor principal
├── db/              # Banco de dados (auto-criado)
├── uploads/         # Imagens enviadas (persistente)
├── Dockerfile
└── docker-compose.yml
```
