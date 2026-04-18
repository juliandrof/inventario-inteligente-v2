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
    "ARARA", "GONDOLA", "CESTAO", "PRATELEIRA", "BALCAO",
    "DISPLAY", "CHECKOUT", "MANEQUIM", "MESA", "CABIDEIRO_PAREDE",
]


def get_fixture_types() -> list[dict]:
    """Load fixture types from DB, fallback to defaults."""
    try:
        from server.database import execute_query
        rows = execute_query("SELECT name, description FROM fixture_types ORDER BY name")
        if rows:
            return rows
    except Exception:
        pass
    return [{"name": t, "description": ""} for t in _DEFAULT_FIXTURE_TYPES]


def get_fixture_type_names() -> list[str]:
    return [ft["name"] for ft in get_fixture_types()]


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


def analyze_frame_fixtures(frame_b64: str) -> list[dict]:
    """Analyze a frame and detect retail fixtures.

    Returns list of dicts:
    [{"type": "GONDOLA", "position": {"x": 30, "y": 50}, "zone": "MIDDLE",
      "occupancy": "FULL", "occupancy_pct": 85, "confidence": 0.9,
      "description": "Gondola de produtos de limpeza"}]
    """
    fixture_types = get_fixture_types()
    type_names = [ft["name"] for ft in fixture_types]
    types_str = ", ".join(type_names)

    # Build descriptions block from DB
    type_descriptions = "\n".join(
        f"- {ft['name']}: {ft['description']}" for ft in fixture_types if ft.get("description")
    )

    system_prompt = (
        "Voce e um sistema de deteccao de objetos especializado em mobiliario de lojas de varejo. "
        "Para cada objeto detectado, retorna tipo, posicao precisa e metadados. "
        "Retorne APENAS um array JSON valido. Sem markdown, sem code fences, sem texto extra."
    )

    user_prompt = f"""TAREFA: Detectar todos os expositores/mobiliarios de loja nesta imagem.

TIPOS VALIDOS:
{type_descriptions}

INSTRUCOES DE DETECCAO:
1. Examine a imagem sistematicamente da esquerda para a direita, de cima para baixo
2. Identifique CADA expositor fisico individual visivel
3. Para cada um, determine a posicao do CENTRO do objeto como percentual da imagem:
   - "x": 0 = borda esquerda, 100 = borda direita
   - "y": 0 = topo, 100 = base
4. Dois objetos do MESMO tipo so devem ser reportados separados se estao FISICAMENTE separados (distancia visivel entre eles)
5. Se um expositor esta parcialmente cortado na borda, reporte apenas se >30% esta visivel
6. NAO reporte o mesmo expositor mais de uma vez

CRITERIOS DE CONFIANCA:
- >= 0.8: certeza alta de que e esse tipo
- 0.6 a 0.8: provavel mas com duvida
- < 0.6: NAO reporte

FORMATO (array JSON):
[{{"type": "TIPO", "position": {{"x": 35, "y": 48}}, "zone": "FRENTE|MEIO|FUNDO|ESQUERDA|DIREITA", "occupancy": "VAZIO|PARCIAL|CHEIO", "occupancy_pct": 75, "confidence": 0.92, "description": "descricao breve em portugues"}}]

Tipos validos: {types_str}
Se nao encontrar nenhum expositor, retorne []"""

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

            valid.append({
                "type": ftype,
                "position": {
                    "x": max(0, min(100, float(pos.get("x", 50)))),
                    "y": max(0, min(100, float(pos.get("y", 50)))),
                },
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
