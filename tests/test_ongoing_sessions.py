import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class OngoingSessionTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for path in ("0001_initial.sql", "0007_night_record_type.sql"):
            self.db.executescript((ROOT / "migrations" / path).read_text())
        self.db.executemany(
            "INSERT INTO players (id,name,normalized_name,created_at) VALUES (?,?,?,?)",
            [("p1","Player One","player one","t"),("p2","Player Two","player two","t")],
        )
        self.db.executemany(
            "INSERT INTO poker_nights (id,title,played_at,created_at,updated_at,record_type) VALUES (?,?,?,?,?,?)",
            [("past","Past","2026-10-01","t1","t1","session"),
             ("draft","Ongoing","2026-10-14","t2","t2","session"),
             ("baseline","Season","2026-02-08","t0","t0","baseline")],
        )
        results = [
            ("1","past","p1",1000,1500), ("2","past","p2",1000,500),
            ("3","draft","p1",1000,0), ("4","draft","p2",1000,0),
            ("5","baseline","p1",5000,5500), ("6","baseline","p2",5000,4500),
        ]
        self.db.executemany(
            "INSERT INTO night_results (id,night_id,player_id,stake_cents,cash_out_cents,created_at) VALUES (?,?,?,?,?,?)",
            [(*row,"t") for row in results],
        )
        self.original_rows = self.db.execute(
            "SELECT id,night_id,player_id,stake_cents,cash_out_cents FROM night_results ORDER BY id"
        ).fetchall()
        self.db.executescript((ROOT / "migrations/0010_ongoing_sessions.sql").read_text())

    def tearDown(self):
        self.db.close()

    def test_migration_does_not_erase_rows(self):
        self.assertEqual(dict(self.db.execute("SELECT id,status FROM poker_nights")),
                         {"past":"completed","draft":"ongoing","baseline":"completed"})
        self.assertEqual(self.db.execute(
            "SELECT id,night_id,player_id,stake_cents,cash_out_cents FROM night_results ORDER BY id"
        ).fetchall(), self.original_rows)

    def test_ledger_keeps_completed_snapshot_unchanged(self):
        rows = self.db.execute(
            "SELECT r.player_id,SUM(r.cash_out_cents-r.stake_cents) "
            "FROM night_results r JOIN poker_nights n ON n.id=r.night_id AND n.status='completed' "
            "GROUP BY r.player_id"
        ).fetchall()
        self.assertEqual(dict(rows), {"p1":1000,"p2":-1000})
        key = self.db.execute(
            "SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), "
            "MAX(CASE WHEN status='completed' THEN updated_at END) FROM poker_nights"
        ).fetchone()
        self.assertEqual(key,(2,"t1"))

    def test_status_constraint(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE poker_nights SET status='invalid' WHERE id='draft'")

    def test_payment_guard_excludes_drafts(self):
        self.assertIn("n.status='completed'", (ROOT / "functions/lib/settlement.ts").read_text())
        self.assertIn("n.status='completed'", (ROOT / "functions/lib/paymentRequests.ts").read_text())


if __name__ == "__main__":
    unittest.main()
