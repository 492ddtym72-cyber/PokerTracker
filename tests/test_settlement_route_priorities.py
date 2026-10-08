import pathlib
import sqlite3
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "migrations" / "0009_settlement_route_priorities.sql"


class SettlementRouteSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
        self.db.executemany(
            "INSERT INTO players (id, name) VALUES (?, ?)",
            [("p1", "Player One"), ("p2", "Player Two"), ("p3", "Player Three")],
        )
        self.db.executescript(MIGRATION.read_text())

    def tearDown(self):
        self.db.close()

    def test_priorities_are_scoped_to_one_snapshot(self):
        self.db.executemany(
            "INSERT INTO settlement_route_priorities "
            "(snapshot_key, from_player_id, to_player_id, priority) VALUES (?, ?, ?, ?)",
            [
                ("round-1", "p1", "p2", 20),
                ("round-1", "p3", "p2", 10),
                ("round-2", "p1", "p3", 5),
            ],
        )
        active = self.db.execute(
            "SELECT from_player_id, to_player_id FROM settlement_route_priorities "
            "WHERE snapshot_key = ? ORDER BY priority, from_player_id, to_player_id",
            ("round-1",),
        ).fetchall()
        future = self.db.execute(
            "SELECT from_player_id, to_player_id FROM settlement_route_priorities "
            "WHERE snapshot_key = ? ORDER BY priority",
            ("round-3",),
        ).fetchall()
        self.assertEqual(active, [("p3", "p2"), ("p1", "p2")])
        self.assertEqual(future, [])

    def test_prevents_duplicate_and_invalid_routes(self):
        self.db.execute(
            "INSERT INTO settlement_route_priorities VALUES (?, ?, ?, ?)",
            ("round-1", "p1", "p2", 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO settlement_route_priorities VALUES (?, ?, ?, ?)",
                ("round-1", "p1", "p2", 2),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO settlement_route_priorities VALUES (?, ?, ?, ?)",
                ("round-1", "p1", "p1", 3),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO settlement_route_priorities VALUES (?, ?, ?, ?)",
                ("round-1", "missing", "p2", 4),
            )


if __name__ == "__main__":
    unittest.main()
