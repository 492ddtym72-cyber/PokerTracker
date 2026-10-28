"""Additive settlement-list schema regression tests on SQLite, as used by D1."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "0012_parallel_settlement_lists.sql").read_text()


def prepare():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
        CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE poker_nights (
          id TEXT PRIMARY KEY, record_type TEXT NOT NULL DEFAULT 'session',
          status TEXT NOT NULL DEFAULT 'completed',
          settlement_mode TEXT NOT NULL DEFAULT 'pooled'
        );
        CREATE TABLE night_results (
          night_id TEXT, player_id TEXT, stake_cents INTEGER, cash_out_cents INTEGER,
          PRIMARY KEY (night_id, player_id)
        );
        CREATE TABLE settlement_payments (
          id TEXT PRIMARY KEY, from_player_id TEXT,to_player_id TEXT,amount_cents INTEGER,
          voided_at TEXT
        );
        CREATE TABLE payment_requests (id TEXT PRIMARY KEY, from_player_id TEXT, to_player_id TEXT);
        CREATE TABLE settlement_route_priorities (
          snapshot_key TEXT,from_player_id TEXT,to_player_id TEXT,priority INTEGER
        );
        INSERT INTO players VALUES ('A','A'),('B','B'),('C','C');
        INSERT INTO poker_nights VALUES ('riga','session','completed','pooled');
        INSERT INTO poker_nights VALUES ('baseline','baseline','completed','pooled');
        INSERT INTO poker_nights VALUES ('single','session','completed','separate');
        INSERT INTO night_results VALUES
          ('riga','A',1000,500),('riga','B',1000,1500),
          ('baseline','A',0,200),('single','A',500,900),('single','C',500,100);
        INSERT INTO settlement_payments VALUES ('oldpay','A','B',120,NULL);
        INSERT INTO payment_requests VALUES ('oldrequest','A','B');
        INSERT INTO settlement_route_priorities VALUES ('v1:legacy','A','B',1);
    """)
    db.executescript(MIGRATION)
    db.execute("INSERT INTO settlement_lists VALUES ('list1','Hamburg','open','now','now')")
    db.execute("INSERT INTO settlement_lists VALUES ('list2','Friends','open','now','now')")
    return db


class SettlementListMigration(unittest.TestCase):
    def test_legacy_riga_ledger_remains_byte_for_byte_untouched(self):
        db = prepare()
        baseline = [
            db.execute("SELECT * FROM poker_nights WHERE id IN ('riga','baseline') ORDER BY id").fetchall(),
            db.execute("SELECT * FROM settlement_payments").fetchall(),
            db.execute("SELECT * FROM payment_requests").fetchall(),
            db.execute("SELECT * FROM settlement_route_priorities").fetchall(),
        ]
        db.execute("INSERT INTO poker_nights VALUES ('hamburg','session','completed','pooled')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('hamburg','list1','now')")
        self.assertEqual(baseline, [
            db.execute("SELECT * FROM poker_nights WHERE id IN ('riga','baseline') ORDER BY id").fetchall(),
            db.execute("SELECT * FROM settlement_payments").fetchall(),
            db.execute("SELECT * FROM payment_requests").fetchall(),
            db.execute("SELECT * FROM settlement_route_priorities").fetchall(),
        ])
        self.assertEqual(db.execute("SELECT COUNT(*) FROM settlement_list_nights").fetchone()[0], 1)

    def test_one_session_one_list_and_independent_debts(self):
        db = prepare()
        db.execute("INSERT INTO poker_nights VALUES ('h1','session','completed','pooled')")
        db.execute("INSERT INTO poker_nights VALUES ('h2','session','completed','pooled')")
        db.executemany("INSERT INTO night_results VALUES (?,?,?,?)", [
            ('h1','A',1000,400),('h1','B',1000,1600),
            ('h2','A',1000,1600),('h2','C',1000,400),
        ])
        db.execute("INSERT INTO settlement_list_nights VALUES ('h1','list1','now')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('h2','list2','now')")
        balances = db.execute("""
            SELECT m.list_id,r.player_id,SUM(r.cash_out_cents-r.stake_cents)
            FROM settlement_list_nights m
            JOIN night_results r ON r.night_id=m.night_id
            GROUP BY m.list_id,r.player_id
            ORDER BY m.list_id,r.player_id
        """).fetchall()
        self.assertEqual(balances, [
            ('list1','A',-600),('list1','B',600),
            ('list2','A',600),('list2','C',-600)
        ])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO settlement_list_nights VALUES ('h1','list2','now')")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM settlement_list_nights").fetchone()[0], 2)

    def test_reject_invalid_or_frozen_assignments(self):
        db = prepare()
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO settlement_list_nights VALUES ('single','list1','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO settlement_list_nights VALUES ('baseline','list1','now')")
        db.execute("INSERT INTO poker_nights VALUES ('h1','session','completed','pooled')")
        db.execute("UPDATE settlement_lists SET status='paying_out' WHERE id='list1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO settlement_list_nights VALUES ('h1','list1','now')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('h1','list2','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE settlement_list_nights SET list_id='list1' WHERE night_id='h1'")
        db.execute("UPDATE settlement_lists SET status='paying_out' WHERE id='list2'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM settlement_list_nights WHERE night_id='h1'")

    def test_payment_isolation_and_frozen_membership(self):
        db = prepare()
        db.execute("INSERT INTO poker_nights VALUES ('h1','session','completed','pooled')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('h1','list1','now')")
        db.execute("""INSERT INTO settlement_list_payments
          (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at)
          VALUES ('pay1','list1','A','B',200,'2026-10-29','token-1','now')""")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM settlement_list_payments WHERE list_id='list2'").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM settlement_payments").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM settlement_list_nights WHERE night_id='h1'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("""INSERT INTO settlement_list_payments
              (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at)
              VALUES ('pay2','list2','A','C',200,'2026-10-29','token-1','now')""")

    def test_db_guard_rejects_enrollment_after_first_payment(self):
        db = prepare()
        db.execute("INSERT INTO poker_nights VALUES ('game1','session','completed','pooled')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('game1','list1','now')")
        db.execute("""INSERT INTO settlement_list_payments
          (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at)
          VALUES ('pay1','list1','A','B',100,'2026-10-29','t-1','now')""")
        db.execute("INSERT INTO poker_nights VALUES ('game2','session','completed','pooled')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO settlement_list_nights VALUES ('game2','list1','now')")

    def test_db_guard_rejects_payments_on_unfinished_or_closed_lists(self):
        db = prepare()
        db.execute("INSERT INTO poker_nights VALUES ('live','session','ongoing','pooled')")
        db.execute("INSERT INTO settlement_list_nights VALUES ('live','list1','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("""INSERT INTO settlement_list_payments
              (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at)
              VALUES ('pay1','list1','A','B',100,'2026-10-29','t-1','now')""")
        db.execute("UPDATE settlement_lists SET status='closed' WHERE id='list2'")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("""INSERT INTO settlement_list_payments
              (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at)
              VALUES ('pay2','list2','A','B',100,'2026-10-29','t-2','now')""")


if __name__ == "__main__":
    unittest.main()
