#!/usr/bin/env python3
"""Read GitHub Copilot Desktop's local session status without opening chats."""
import argparse
import datetime
import json
import os
from pathlib import Path
import sqlite3
import sys
import time


def timestamp(value):
    try:
        return int(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)
    except (TypeError, ValueError, AttributeError):
        return 0


def read_feed(database, now=None, recent_hours=2):
    now = int(time.time() * 1000) if now is None else now
    database = Path(database).expanduser().resolve()
    if not database.is_file():
        return {'company': 'GitHub Copilot Desktop', 'agents': []}
    # Never select titles, prompts, messages, tokens, accounts or provider settings.
    connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=1)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('PRAGMA query_only = ON')
        rows = connection.execute('''
            SELECT id, is_running, was_interrupted, created_at, updated_at
            FROM sessions
            WHERE archived_at IS NULL AND execution_location = 'local' AND provisional = 0
            ORDER BY is_running DESC, updated_at DESC LIMIT 40
        ''').fetchall()
    finally:
        connection.close()
    agents = []
    for row in rows:
        updated = timestamp(row['updated_at'])
        running = bool(row['is_running'])
        if not running and now - updated > recent_hours * 3600000:
            continue
        status = 'running' if running else 'paused' if row['was_interrupted'] else 'idle'
        agents.append({
            'id': 'copilot-desktop:' + row['id'],
            'name': 'Copilot Desktop · ' + row['id'][:8],
            'role': 'GitHub Copilot Desktop',
            'status': status,
            'task': 'Working' if running else None,
            'error': None,
            'since': timestamp(row['created_at']),
            'updated': updated,
        })
    return {'company': 'GitHub Copilot Desktop', 'agents': agents}


def write_feed(output, feed):
    output = Path(output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = output.with_name(output.name + '.' + str(os.getpid()) + '.tmp')
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
            json.dump(feed, stream, ensure_ascii=False)
            stream.write('\n')
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=Path.home() / '.copilot' / 'data.db')
    parser.add_argument('--output', type=Path, default=Path.home() / '.cubicle' / 'github-copilot-desktop.json')
    parser.add_argument('--interval', type=float, default=3)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--stdout', action='store_true', help='Print one snapshot for an existing feed collector')
    args = parser.parse_args()
    if args.interval < 1:
        parser.error('--interval must be at least 1 second')
    if args.database.expanduser().resolve() == args.output.expanduser().resolve():
        parser.error('--output must not be the Copilot database')
    while True:
        try:
            feed = read_feed(args.database)
            if args.stdout:
                print(json.dumps(feed, ensure_ascii=False))
                return
            write_feed(args.output, feed)
        except (OSError, sqlite3.Error):
            # Fail visibly and preserve the last feed if the schema or access changes.
            print('Cannot read Copilot Desktop status or write its feed; check paths and database schema.', file=sys.stderr)
            if args.once or args.stdout:
                sys.exit(1)
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
