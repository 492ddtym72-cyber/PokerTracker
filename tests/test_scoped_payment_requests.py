"""Regression checks: payment-request migration preserves Riga and isolates scopes."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
A, B = "player_" + "a" * 24, "player_" + "b" * 24

class ScopedPaymentRequestTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            self.db.executescript(migration.read_text())
        self.db.executemany(
            "INSERT INTO players(id,name,normalized_name,created_at) VALUES(?,?,?,?)",
            [(A,"A","a","2026-01-01"),(B,"B","b","2026-01-01")],
        )
        self.db.execute(
            "INSERT INTO poker_nights(id,title,played_at,created_at,updated_at,settlement_mode,status) VALUES(?,?,?,?,?,'separate','completed')",
            ("night","Test","2026-01-01","2026-01-01","2026-01-01"),
        )
        self.db.execute(
            "INSERT INTO settlement_lists(id,name,status,created_at,updated_at) VALUES('list','Custom','paying_out','2026-01-01','2026-01-01')"
        )

    def tearDown(self):
        self.db.close()

    def request(self, rid, kind=None, ledger_id=None):
        self.db.execute(
            """INSERT INTO payment_requests
               (id,from_player_id,to_player_id,amount_cents,created_at,client_token,ledger_kind,ledger_id)
               VALUES(?,?,?,1000,'2026-01-01',?,?,?)""",
            (rid,A,B,rid+"-token",kind or "legacy",ledger_id),
        )
        self.db.execute(
            "INSERT INTO payment_reports(id,request_id,amount_cents,status,created_at,client_token) VALUES(?, ?, 500, 'confirmed','2026-01-02',?)",
            ("report-"+rid,rid,"report-"+rid),
        )

    def test_old_requests_default_to_riga(self):
        self.db.execute(
            "INSERT INTO payment_requests(id,from_player_id,to_player_id,amount_cents,created_at,client_token) VALUES('old',?,?,1000,'2026-01-01','old-token')",
            (A,B),
        )
        self.assertEqual(
            self.db.execute("SELECT ledger_kind,ledger_id FROM payment_requests WHERE id='old'").fetchone(),
            ("legacy",None),
        )

    def test_report_payments_are_isolated_by_ledger(self):
        self.request("legacy")
        self.request("session","session","night")
        self.request("named","list","list")
        self.db.execute(
            """INSERT INTO settlement_payments
            (id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
            VALUES('p-legacy',?,?,500,'2026-01-02','p-legacy','2026-01-02','report-legacy')""", (A,B),
        )
        self.db.execute(
            """INSERT INTO session_settlement_payments
            (id,night_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
            VALUES('p-session','night',?,?,500,'2026-01-02','p-session','2026-01-02','report-session')""",(A,B),
        )
        self.db.execute(
            """INSERT INTO settlement_list_payments
            (id,list_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
            VALUES('p-list','list',?,?,500,'2026-01-02','p-list','2026-01-02','report-named')""",(A,B),
        )
        for table, rid in [
            ("settlement_payments","legacy"),
            ("session_settlement_payments","session"),
            ("settlement_list_payments","named"),
        ]:
            total=self.db.execute(
                f"""SELECT SUM(p.amount_cents) FROM {table} p
                JOIN payment_reports report ON report.id=p.payment_report_id
                WHERE report.request_id=? AND p.voided_at IS NULL""",(rid,)
            ).fetchone()[0]
            self.assertEqual(total,500)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO session_settlement_payments
                (id,night_id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
                VALUES('duplicate','night',?,?,500,'2026-01-02','duplicate','2026-01-02','report-session')""",(A,B),
            )
        self.db.execute("UPDATE session_settlement_payments SET voided_at='2026-01-03' WHERE id='p-session'")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM session_settlement_payments WHERE voided_at IS NULL AND payment_report_id='report-session'"
        ).fetchone()[0],0)

if __name__ == "__main__":
    unittest.main()
