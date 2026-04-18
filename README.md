# Inventario Inteligente de Expositores

**Aplicacao Databricks para inventario automatizado de expositores em lojas de varejo usando IA de visao computacional.**

Faca upload de videos gravados nas lojas e a IA identifica, classifica e conta automaticamente todos os expositores (araras, gondolas, cestoes, prateleiras, displays, checkouts, etc.) com deduplicacao inteligente entre frames.

---

## Funcionalidades

| Funcionalidade | Descricao |
|---|---|
| **Upload de Videos** | Drag & drop com validacao de nomenclatura `UF_IDLOJA_yyyymmdd.mp4` |
| **Deteccao por IA** | Vision model analisa frames e identifica tipo, posicao e ocupacao de cada expositor |
| **Anti-Duplicidade** | Rastreamento por posicao entre frames garante contagem precisa sem repetir |
| **Ocupacao** | Classifica cada expositor como Vazio, Parcial ou Cheio (com percentual) |
| **Dashboard** | KPIs, graficos por tipo/UF/loja, heatmap de ocupacao, anomalias |
| **Revisao IA** | Inspecao frame-a-frame do trabalho da IA com thumbnails e descricoes |
| **Anomalias** | Alerta automatico quando loja tem contagem fora da media da UF |
| **Comparativo Temporal** | Evolucao de expositores entre diferentes datas para mesma loja |
| **Exportacao** | CSV e JSON com filtros por UF e loja |
| **Modelo Configuravel** | Troque entre modelos FMAPI ou use um modelo custom treinado por voce |
| **Tipos Configuraveis** | Adicione, edite ou remova tipos de expositores pela interface |

---

## Arquitetura

```
Video MP4 --> [FastAPI Backend] --> [FMAPI Vision Model] --> [FixtureTracker]
                   |                                              |
                   v                                              v
            [Unity Catalog]                               [Lakebase PostgreSQL]
             Volumes (videos                              Fixtures, Detections,
              + thumbnails)                               Summaries, Anomalias
                   |
                   v
            [React Frontend]
            Dashboard, Review,
            Reports, Settings
```

| Componente | Tecnologia |
|---|---|
| Frontend | React 19 + Vite |
| Backend | FastAPI (Python) |
| IA/Visao | Databricks Foundation Model API |
| Banco de Dados | Lakebase (PostgreSQL gerenciado) |
| Storage | Unity Catalog Volumes |
| Deploy | Databricks Apps |

---

## Deploy Rapido

Veja o guia completo em **[DEPLOY.md](DEPLOY.md)** - em 5 passos voce tem o app rodando.

**Requisitos:**
- Workspace Databricks com Lakebase e FMAPI habilitados
- Databricks CLI v0.250+
- Node.js 18+ (para build do frontend)

---

## Nomenclatura dos Videos

Os videos devem seguir o padrao:

```
UF_IDLOJA_yyyymmdd.mp4
```

Exemplos:
- `SP_1234_20260415.mp4` - Loja 1234 em Sao Paulo, filmada em 15/04/2026
- `RJ_5678_20260410.mov` - Loja 5678 no Rio de Janeiro, filmada em 10/04/2026

---

## Tipos de Expositores (default)

| Tipo | Descricao |
|---|---|
| ARARA | Arara de roupas (cabideiro circular ou reto) |
| GONDOLA | Gondola/estante com multiplas prateleiras |
| CESTAO | Cesto grande para produtos a granel/promocoes |
| PRATELEIRA | Prateleira de parede |
| BALCAO | Balcao de atendimento ou vitrine |
| DISPLAY | Display promocional / ponta de gondola |
| CHECKOUT | Caixa registradora |
| MANEQUIM | Manequim de vitrine |
| MESA | Mesa expositora |
| CABIDEIRO_PAREDE | Cabideiro fixo na parede |

Todos os tipos sao configuraveis pela interface em **Configuracoes > Tipos de Expositores**.

---

## Licenca

Uso interno. Desenvolvido com Databricks Lakebase, Foundation Model API e Databricks Apps.
