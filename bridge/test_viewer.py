import unittest
from unittest.mock import Mock, patch
import viewer


class AndroidTests(unittest.TestCase):
    def setUp(self):
        self.android = viewer.Android()
        self.android.serial = 'emulator-5554'

    def test_state_tolerates_empty_avd_name_during_shutdown(self):
        self.android.adb = Mock(side_effect=['List of devices attached\nemulator-5554 device\n', ''])
        with patch('viewer.run', return_value='bb_api34'):
            state = self.android.state()
        self.assertEqual(state['devices'], [{'serial':'emulator-5554', 'name':'emulator-5554', 'status':'device'}])

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

    def test_clipboard_preserves_unicode_whitespace_and_is_bounded(self):
        text = '  Из Android ёж 😀\n'
        with patch('viewer.subprocess.check_output', return_value=text.encode()):
            self.assertEqual(self.android.control('clipboard', {}), {'text': text})
        with patch('viewer.subprocess.check_output', return_value=('я'*32769).encode()):
            with self.assertRaises(ValueError):
                self.android.control('clipboard', {})
        with patch('viewer.subprocess.check_output', side_effect=viewer.subprocess.CalledProcessError(1, 'xclip')):
            self.assertEqual(self.android.control('clipboard', {}), {'text': ''})

    def test_stop_targets_only_selected_emulator_and_waits_for_exit(self):
        self.android.state = Mock(return_value={'devices': [{'serial':'emulator-5554','status':'device'}]})
        self.android.adb = Mock()
        self.assertEqual(self.android.control('stop', {'serial':'emulator-5554'}), {'stopped':'emulator-5554'})
        self.assertEqual(self.android.adb.call_args_list, [
            unittest.mock.call('emu', 'kill', serial='emulator-5554'),
            unittest.mock.call('wait-for-disconnect', serial='emulator-5554')])
        self.assertIsNone(self.android.serial)

    def test_stop_rejects_stale_or_invalid_target(self):
        self.android.adb = Mock()
        self.android.state = Mock(return_value={'devices': []})
        for target in ['emulator-5556','emulator-5554','-a',None]:
            with self.assertRaises(ValueError):
                self.android.control('stop', {'serial':target})
        self.android.adb.assert_not_called()

    def test_failed_stop_preserves_selection(self):
        self.android.state = Mock(return_value={'devices': [{'serial':'emulator-5554','status':'device'}]})
        self.android.adb = Mock(side_effect=viewer.subprocess.CalledProcessError(1,'adb'))
        with self.assertRaises(viewer.subprocess.CalledProcessError):
            self.android.control('stop', {'serial':'emulator-5554'})
        self.assertEqual(self.android.serial,'emulator-5554')

    def test_close_stops_only_owned_scrcpy(self):
        proc = Mock()
        proc.poll.return_value = None
        self.android.scrcpy = proc
        self.android.close()
        proc.terminate.assert_called_once()
        self.assertIsNone(self.android.serial)


if __name__ == '__main__':
    unittest.main()
