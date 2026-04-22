"""Foundation Model API client for retail fixture detection."""

import os
import json
import logging
import re
import urllib.request
import urllib.error
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = os.environ.get("FMAPI_MODEL", "databricks-llama-4-maverick")

_DEFAULT_FIXTURE_TYPES = [
    "ARARA", "BALCAO", "CABIDEIRO_PAREDE", "CESTAO",
    "DISPLAY", "GONDOLA", "PRATELEIRA",
]


def get_fixture_types(context_id: int = None) -> list[dict]:
    """Load fixture/object types from DB, fallback to defaults.

    If context_id is provided, reads from context_object_types for that context.
    Otherwise falls back to fixture_types table.
    """
    try:
        from server.database import execute_query
        if context_id:
            rows = execute_query(
                "SELECT name, description FROM context_object_types WHERE context_id = %(cid)s ORDER BY name",
                {"cid": context_id}
            )
            if rows:
                return rows
        rows = execute_query("SELECT name, description FROM fixture_types ORDER BY name")
        if rows:
            return rows
    except Exception:
        pass
    return [{"name": t, "description": ""} for t in _DEFAULT_FIXTURE_TYPES]


def get_fixture_type_names(context_id: int = None) -> list[str]:
    return [ft["name"] for ft in get_fixture_types(context_id)]


def _get_context_info(context_id: int = None) -> dict:
    """Load context metadata (description, display_name) for prompt building."""
    if not context_id:
        return {
            "display_name": "Expositores de Loja",
            "description": "Mobiliario e expositores de lojas de varejo: gondolas, araras, balcoes, prateleiras, displays",
        }
    try:
        from server.database import execute_query
        rows = execute_query(
            "SELECT display_name, description FROM contexts WHERE context_id = %(cid)s",
            {"cid": context_id}
        )
        if rows:
            return {"display_name": rows[0]["display_name"], "description": rows[0]["description"] or ""}
    except Exception:
        pass
    return {
        "display_name": "Expositores de Loja",
        "description": "Mobiliario e expositores de lojas de varejo",
    }


def _get_model() -> str:
    try:
        from server.database import get_config
        val = get_config("fmapi_model")
        if val:
            return val
    except Exception:
        pass
    return _DEFAULT_MODEL


def _get_auth():
    is_app = bool(os.environ.get("DATABRICKS_APP_NAME"))
    if is_app:
        w = WorkspaceClient()
    else:
        profile = os.environ.get("DATABRICKS_PROFILE")
        w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()

    host = w.config.host.rstrip("/")
    headers = w.config.authenticate()
    token = headers.get("Authorization", "").replace("Bearer ", "") if headers else ""
    if not token and w.config.token:
        token = w.config.token
    return host, token


def _call_serving(payload: dict, timeout: int = 120) -> dict:
    host, token = _get_auth()
    model = _get_model()
    url = f"{host}/serving-endpoints/{model}/invocations"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"FMAPI HTTP {e.code}: {body[:300]}")


def analyze_frame_fixtures(frame_b64: str, context_id: int = None) -> list[dict]:
    """Analyze a frame and detect objects based on context.

    Returns list of dicts:
    [{"type": "GONDOLA", "position": {"x": 30, "y": 50}, "zone": "MIDDLE",
      "occupancy": "FULL", "occupancy_pct": 85, "confidence": 0.9,
      "description": "Gondola de produtos de limpeza"}]
    """
    fixture_types = get_fixture_types(context_id)
    type_names = [ft["name"] for ft in fixture_types]
    types_str = ", ".join(type_names)

    # Build descriptions block from DB
    type_descriptions = "\n".join(
        f"- {ft['name']}: {ft['description']}" for ft in fixture_types if ft.get("description")
    )

    # Build context-aware prompts
    ctx_info = _get_context_info(context_id)
    ctx_display = ctx_info["display_name"]
    ctx_desc = ctx_info["description"]

    system_prompt = (
        f"Voce e um sistema de deteccao de objetos especializado em {ctx_desc}. "
        "Para cada objeto detectado, retorna tipo, posicao precisa e metadados. "
        "Retorne APENAS um array JSON valido. Sem markdown, sem code fences, sem texto extra."
    )

    user_prompt = f"""TAREFA: Detectar todos os objetos do tipo '{ctx_display}' nesta imagem.

TIPOS VALIDOS:
{type_descriptions}

INSTRUCOES DE DETECCAO:
1. Examine a imagem sistematicamente da esquerda para a direita, de cima para baixo
2. Identifique CADA objeto individual visivel dos tipos listados acima
3. Para cada um, determine a posicao do CENTRO do objeto como percentual da imagem:
   - "x": 0 = borda esquerda, 100 = borda direita
   - "y": 0 = topo, 100 = base
4. Para cada um, estime a LARGURA e ALTURA do bounding box como percentual da imagem:
   - "bbox_w": largura do objeto como % da largura total da imagem (ex: gondola grande = 30-50, display pequeno = 10-20)
   - "bbox_h": altura do objeto como % da altura total da imagem (ex: gondola alta = 40-70, mesa baixa = 15-30)
   - Os valores devem refletir o tamanho REAL do objeto na imagem, nao um valor fixo
5. Dois objetos do MESMO tipo so devem ser reportados separados se estao FISICAMENTE separados (distancia visivel entre eles)
6. Se um objeto esta parcialmente cortado na borda, reporte apenas se >30% esta visivel
7. NAO reporte o mesmo objeto mais de uma vez

CRITERIOS DE CONFIANCA:
- >= 0.8: certeza alta de que e esse tipo
- 0.6 a 0.8: provavel mas com duvida
- < 0.6: NAO reporte

FORMATO (array JSON):
[{{"type": "TIPO", "position": {{"x": 35, "y": 48}}, "bbox_w": 25, "bbox_h": 40, "zone": "FRENTE|MEIO|FUNDO|ESQUERDA|DIREITA", "occupancy": "VAZIO|PARCIAL|CHEIO", "occupancy_pct": 75, "confidence": 0.92, "description": "descricao breve em portugues"}}]

Tipos validos: {types_str}
Se nao encontrar nenhum objeto dos tipos listados, retorne []"""

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
                    {"type": "text", "text": user_prompt},
                ],
            },
        ],
        "max_tokens": 2000,
    }

    # temperature not supported by all models (e.g. Claude Opus 4.7)
    # Try with it first, retry without on 400
    try:
        payload["temperature"] = 0.1
        response = _call_serving(payload)
    except RuntimeError as e:
        if "temperature" in str(e).lower():
            logger.info("Retrying without temperature parameter")
            del payload["temperature"]
            response = _call_serving(payload)
        else:
            raise

    try:
        raw = response["choices"][0]["message"]["content"].strip()
        logger.info(f"FMAPI response: {raw[:300]}")

        # Extract JSON array
        json_match = re.search(r'\[.*\]', raw, re.DOTALL)
        if json_match:
            fixtures = json.loads(json_match.group())
        else:
            fixtures = json.loads(raw)

        if not isinstance(fixtures, list):
            fixtures = [fixtures] if isinstance(fixtures, dict) else []

        # Validate and normalize
        valid = []
        for f in fixtures:
            if not isinstance(f, dict):
                continue
            ftype = str(f.get("type", "")).upper().strip()
            if ftype not in type_names:
                continue

            pos = f.get("position", {})
            if not isinstance(pos, dict):
                pos = {"x": 50, "y": 50}

            # Extract bounding box dimensions (percentage of image)
            bbox_w = float(f.get("bbox_w", 0) or 0)
            bbox_h = float(f.get("bbox_h", 0) or 0)
            # Clamp to reasonable range (3-90% of image)
            if bbox_w > 0:
                bbox_w = max(3, min(90, bbox_w))
            if bbox_h > 0:
                bbox_h = max(3, min(90, bbox_h))

            valid.append({
                "type": ftype,
                "position": {
                    "x": max(0, min(100, float(pos.get("x", 50)))),
                    "y": max(0, min(100, float(pos.get("y", 50)))),
                },
                "bbox_w": bbox_w,
                "bbox_h": bbox_h,
                "zone": str(f.get("zone", "MEIO")).upper(),
                "occupancy": _normalize_occupancy(f.get("occupancy", "PARCIAL")),
                "occupancy_pct": max(0, min(100, float(f.get("occupancy_pct", 50)))),
                "confidence": max(0, min(1, float(f.get("confidence", 0.7)))),
                "description": str(f.get("description", "")),
            })

        return valid

    except Exception as e:
        logger.error(f"FMAPI fixture analysis failed: {e}")
        return []


def _normalize_occupancy(val) -> str:
    val = str(val).upper().strip()
    mapping = {
        "VAZIO": "VAZIO", "EMPTY": "VAZIO",
        "PARCIAL": "PARCIAL", "PARTIAL": "PARCIAL",
        "CHEIO": "CHEIO", "FULL": "CHEIO",
    }
    return mapping.get(val, "PARCIAL")
