import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'examples/github-copilot/desktop.py'
spec = importlib.util.spec_from_file_location('copilot_desktop', SCRIPT)
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopTests(unittest.TestCase):
    def test_live_database_and_privacy(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'data.db'
            writer = sqlite3.connect(db)
            writer.execute('PRAGMA journal_mode = WAL')
            writer.execute('''CREATE TABLE sessions (id TEXT, is_running INTEGER,
                was_interrupted INTEGER, created_at TEXT, updated_at TEXT,
                archived_at TEXT, execution_location TEXT, provisional INTEGER, title TEXT)''')
            now = desktop.timestamp('2026-10-04T15:30:00Z')
            recent = '2026-10-04T15:29:00Z'
            old = '2026-10-03T15:29:00Z'
            def add(sid, running=0, interrupted=0, updated=recent, archived=None, location='local', provisional=0):
                writer.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)',
                    (sid, running, interrupted, old, updated, archived, location, provisional, 'PRIVATE TITLE'))
            add('active', running=1, updated=old)
            add('finished')
            add('interrupted', interrupted=1)
            add('old', updated=old)
            add('archived', archived=recent)
            add('remote', location='remote')
            add('provisional', provisional=1)
            writer.commit()
            feed = desktop.read_feed(db, now)
            states = {a['id']: a['status'] for a in feed['agents']}
            self.assertEqual(states, {'copilot-desktop:active': 'running',
                'copilot-desktop:finished': 'idle', 'copilot-desktop:interrupted': 'paused'})
            self.assertNotIn('PRIVATE', json.dumps(feed))
            writer.execute("UPDATE sessions SET is_running=0,updated_at=? WHERE id='active'", (recent,))
            writer.commit()
            self.assertEqual(next(a for a in desktop.read_feed(db, now)['agents']
                if a['id'] == 'copilot-desktop:active')['status'], 'idle')
            self.assertEqual(writer.execute('SELECT count(*) FROM sessions').fetchone()[0], 7)
            output = Path(folder) / 'out' / 'feed.json'
            desktop.write_feed(output, feed)
            self.assertEqual(json.loads(output.read_text()), feed)
            if os.name != 'nt':
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(output.parent.glob('*.tmp')), [])
            writer.close()

    def test_missing_database_does_not_create_one(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'missing.db'
            result = subprocess.run(['python3', str(SCRIPT), '--database', str(db), '--stdout'],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)['agents'], [])
            self.assertFalse(db.exists())

    def test_schema_failure_preserves_feed_and_database(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'wrong.db'
            sqlite3.connect(db).close()
            output = Path(folder) / 'feed.json'
            output.write_text('previous feed')
            before = db.read_bytes()
            result = subprocess.run(['python3', str(SCRIPT), '--database', str(db),
                '--output', str(output), '--once'], capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(output.read_text(), 'previous feed')
            self.assertEqual(db.read_bytes(), before)
            result = subprocess.run(['python3', str(SCRIPT), '--database', str(db),
                '--output', str(db), '--once'], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(db.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
