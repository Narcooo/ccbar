import json
import os
import tempfile
import unittest
from unittest import mock

from ccbar import main as ccbar_main


def _write_jsonl(path, entries):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")


class CostStatsTests(unittest.TestCase):
    def test_scan_tokens_deduplicates_message_ids_across_project_files(self):
        usage = {
            "input_tokens": 1000,
            "output_tokens": 200,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }
        entry = {
            "timestamp": "2026-03-14T10:00:00Z",
            "type": "assistant",
            "message": {
                "id": "msg_same",
                "model": "claude-sonnet-4-6",
                "usage": usage,
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = os.path.join(tmpdir, "demo-project")
            _write_jsonl(os.path.join(project_dir, "parent.jsonl"), [entry])
            _write_jsonl(
                os.path.join(project_dir, "subagents", "child.jsonl"),
                [entry],
            )

            with mock.patch.object(ccbar_main, "PROJECTS_DIR", tmpdir):
                stats = ccbar_main.scan_tokens()

        self.assertEqual(stats["all_tok"], 1200)
        self.assertAlmostEqual(stats["all_cost"], 0.006, places=6)

    def test_est_cost_normalizes_versioned_models_and_prices_1h_cache_creation(self):
        usage = {
            "input_tokens": 1000,
            "output_tokens": 100,
            "cache_creation_input_tokens": 500,
            "cache_read_input_tokens": 200,
            "cache_creation": {
                "ephemeral_5m_input_tokens": 0,
                "ephemeral_1h_input_tokens": 500,
            },
        }

        base, cache_read = ccbar_main.est_cost("claude-opus-4-5-20251101", usage)

        self.assertAlmostEqual(base, 0.0375, places=6)
        self.assertAlmostEqual(cache_read, 0.0003, places=6)


if __name__ == "__main__":
    unittest.main()
