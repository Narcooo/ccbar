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


if __name__ == "__main__":
    unittest.main()
