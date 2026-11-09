import json
from pathlib import Path
from app.models import Plan, Analysis

destination = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "schemas"
destination.mkdir(parents=True, exist_ok=True)
for name, model in [("plan", Plan), ("analysis", Analysis)]:
    (destination / f"{name}.json").write_text(json.dumps(model.model_json_schema(), indent=2) + "\n", encoding="utf-8")
