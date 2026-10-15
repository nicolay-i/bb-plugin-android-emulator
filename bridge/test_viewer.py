import unittest
from unittest.mock import Mock, patch
import viewer


class AndroidTests(unittest.TestCase):
    def setUp(self):
        self.android = viewer.Android()
        self.android.serial = 'emulator-5554'

    def test_system_key_targets_selected_device(self):
        self.android.adb = Mock()
        self.android.control('key', {'key': 'back'})
        self.android.adb.assert_called_once_with('shell', 'input', 'keyevent', '4')
        with self.assertRaises(ValueError):
            self.android.control('key', {'key': 'reboot'})

    def test_cannot_select_missing_device_or_launch_arbitrary_argument(self):
        self.android.state = Mock(return_value={'devices': [], 'avds':['bb_api34']})
        with patch('viewer.subprocess.Popen') as spawn:
            for action, body in [('select', {'serial':'emulator-9999'}), ('start', {'avd':'-wipe-data'})]:
                with self.assertRaises(ValueError):
                    self.android.control(action, body)
            spawn.assert_not_called()

    def test_paste_validates_utf8_size_and_preserves_unicode(self):
        with patch('viewer.subprocess.run') as execute:
            text = 'Проверка ёж café 😀'
            self.android.control('paste', {'text':text})
            self.assertEqual(execute.call_args_list[0].kwargs['input'], text.encode())
            with self.assertRaises(ValueError):
                self.android.control('paste', {'text':'я'*32769})

    def test_close_stops_only_owned_scrcpy(self):
        proc = Mock()
        proc.poll.return_value = None
        self.android.scrcpy = proc
        self.android.close()
        proc.terminate.assert_called_once()
        self.assertIsNone(self.android.serial)


if __name__ == '__main__':
    unittest.main()
