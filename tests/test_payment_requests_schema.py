"""SQLite schema smoke tests for payment requests and settlement ledger."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
A = "player_" + "a" * 24
B = "player_" + "b" * 24


class PaymentRequestSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            self.db.executescript(migration.read_text())
        self.db.executemany(
            "INSERT INTO players(id,name,normalized_name,created_at) VALUES(?,?,?,?)",
            [(A, "Alex", "alex", "2026-01-01"), (B, "Bea", "bea", "2026-01-01")],
        )
        self.db.execute(
            "INSERT INTO poker_nights(id,title,played_at,created_at,updated_at) VALUES(?,?,?,?,?)",
            ("night", "Night", "2026-01-01", "2026-01-01", "2026-01-01"),
        )
        self.db.executemany(
            """INSERT INTO night_results(id,night_id,player_id,stake_cents,cash_out_cents,created_at)
               VALUES(?,?,?,?,?,?)""",
            [("result_a", "night", A, 10000, 0, "2026-01-01"),
             ("result_b", "night", B, 0, 10000, "2026-01-01")],
        )
        self.db.execute(
            """INSERT INTO payment_requests
            (id,from_player_id,to_player_id,amount_cents,created_at,client_token)
            VALUES('req',?,?,10000,'2026-01-01','request-token')""",
            (A, B),
        )

    def tearDown(self):
        self.db.close()

    def test_request_does_not_change_financial_balance(self):
        balance = self.db.execute(
            "SELECT SUM(cash_out_cents-stake_cents) FROM night_results"
        ).fetchone()[0]
        self.assertEqual(balance, 0)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM settlement_payments").fetchone()[0], 0
        )

    def test_confirmation_can_link_partial_payment_only_once(self):
        self.db.execute(
            """INSERT INTO payment_reports
            (id,request_id,amount_cents,status,created_at,client_token)
            VALUES('report','req',2000,'reported','2026-01-02','report-token')"""
        )
        self.db.execute(
            """INSERT INTO settlement_payments
            (id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
            VALUES('payment',?,?,2000,'2026-01-02','payment-token','2026-01-02','report')""",
            (A, B),
        )
        self.db.execute("UPDATE payment_reports SET status='confirmed' WHERE id='report'")
        paid = self.db.execute(
            """SELECT SUM(sp.amount_cents) FROM payment_reports pr
            JOIN settlement_payments sp ON sp.payment_report_id=pr.id
            WHERE pr.request_id='req' AND sp.voided_at IS NULL"""
        ).fetchone()[0]
        self.assertEqual(paid, 2000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO settlement_payments
                (id,from_player_id,to_player_id,amount_cents,paid_at,client_token,created_at,payment_report_id)
                VALUES('payment2',?,?,2000,'2026-01-02','payment-token2','2026-01-02','report')""",
                (A, B),
            )
        self.db.execute("UPDATE settlement_payments SET voided_at='2026-01-03' WHERE id='payment'")
        active = self.db.execute(
            "SELECT COUNT(*) FROM settlement_payments WHERE payment_report_id='report' AND voided_at IS NULL"
        ).fetchone()[0]
        self.assertEqual(active, 0)

    def test_rejects_self_requests_and_duplicate_tokens(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO payment_requests(id,from_player_id,to_player_id,amount_cents,created_at,client_token)
                VALUES('self',?,?,100,'2026-01-01','unique')""", (A, A)
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO payment_requests(id,from_player_id,to_player_id,amount_cents,created_at,client_token)
                VALUES('duplicate',?,?,100,'2026-01-01','request-token')""", (A, B)
            )

    def test_notification_references_real_players_and_requests(self):
        self.db.execute(
            """INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
               VALUES('event','req',?,'request','2026-01-02')""", (A,)
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO payment_request_events(id,request_id,to_player_id,kind,created_at)
                   VALUES('bad','missing',?,'request','2026-01-02')""", (A,)
            )


if __name__ == "__main__":
    unittest.main()
