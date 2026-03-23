import io
import unittest
from unittest import mock

from ccbar import main as ccbar_main


class PythonDebugWrapperTests(unittest.TestCase):
    def test_run_node_cli_forwards_arguments_and_exit_code(self):
        completed = mock.Mock(returncode=7)

        with mock.patch.object(ccbar_main, "_repo_root", return_value="/repo"), mock.patch.object(
            ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"
        ), mock.patch.object(ccbar_main, "_find_node", return_value="node"), mock.patch.object(
            ccbar_main.os.path, "exists", return_value=True
        ), mock.patch(
            "subprocess.run", return_value=completed
        ) as run_mock:
            exit_code = ccbar_main.cli(["doctor"], stdin_data=b"")

        self.assertEqual(exit_code, 7)
        run_mock.assert_called_once_with(
            ["node", "/repo/dist/cli.js", "doctor"],
            input=b"",
        )

    def test_run_node_cli_forwards_stdin_bytes(self):
        completed = mock.Mock(returncode=0)
        fake_stdin = io.BytesIO(b'{"session_id":"abc"}')

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), mock.patch.object(
            ccbar_main, "_find_node", return_value="node"
        ), mock.patch.object(
            ccbar_main.os.path, "exists", return_value=True
        ), mock.patch(
            "sys.stdin", mock.Mock(buffer=fake_stdin)
        ), mock.patch(
            "subprocess.run", return_value=completed
        ) as run_mock:
            exit_code = ccbar_main.cli([])

        self.assertEqual(exit_code, 0)
        self.assertEqual(run_mock.call_args.kwargs["input"], b'{"session_id":"abc"}')

    def test_missing_build_prints_npm_run_build_hint(self):
        stderr = io.StringIO()

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), mock.patch.object(
            ccbar_main.os.path, "exists", return_value=False
        ), mock.patch("sys.stderr", stderr):
            exit_code = ccbar_main.cli([])

        self.assertEqual(exit_code, 1)
        self.assertIn("npm run build", stderr.getvalue())

    def test_missing_node_prints_install_hint(self):
        stderr = io.StringIO()

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), mock.patch.object(
            ccbar_main.os.path, "exists", return_value=True
        ), mock.patch.object(ccbar_main, "_find_node", return_value=None), mock.patch(
            "sys.stderr", stderr
        ):
            exit_code = ccbar_main.cli([])

        self.assertEqual(exit_code, 1)
        self.assertIn("Node 20+", stderr.getvalue())

    def test_subcommand_does_not_read_stdin_when_data_omitted(self):
        completed = mock.Mock(returncode=0)
        read_mock = mock.Mock(side_effect=AssertionError("stdin should not be read"))
        fake_stdin = mock.Mock(buffer=mock.Mock(read=read_mock))

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), mock.patch.object(
            ccbar_main, "_find_node", return_value="node"
        ), mock.patch.object(
            ccbar_main.os.path, "exists", return_value=True
        ), mock.patch(
            "sys.stdin", fake_stdin
        ), mock.patch(
            "subprocess.run", return_value=completed
        ) as run_mock:
            exit_code = ccbar_main.cli(["doctor"])

        self.assertEqual(exit_code, 0)
        read_mock.assert_not_called()
        self.assertIsNone(run_mock.call_args.kwargs["input"])


if __name__ == "__main__":
    unittest.main()
