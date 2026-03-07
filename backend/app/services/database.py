"""Database service"""
import aiosqlite
from typing import Optional
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from app.config import get_settings, resolve_runtime_state_dir


def _resolve_database_path() -> str:
    """
    Resolve SQLite file path from settings.database_url.
    Use a stable absolute path so launching backend from different cwd does not
    accidentally create different DB files.
    """
    settings = get_settings()
    raw = (settings.database_url or "").strip()
    runtime_state_dir = resolve_runtime_state_dir()

    if not raw:
        return str((runtime_state_dir / "ollama_studio.db").resolve())

    # Accept plain sqlite file path
    if "://" not in raw:
        path = Path(raw)
        if not path.is_absolute():
            path = runtime_state_dir / path
        return str(path.resolve())

    parsed = urlparse(raw)
    if not parsed.scheme.startswith("sqlite"):
        raise ValueError(f"Unsupported database_url scheme: {parsed.scheme}")

    # sqlite+aiosqlite:///./ollama_studio.db -> /./ollama_studio.db
    db_path = parsed.path or ""
    if db_path.startswith("/") and not db_path.startswith("//"):
        db_path = db_path[1:]
    path = Path(db_path)
    if not path.is_absolute():
        path = runtime_state_dir / path
    return str(path.resolve())


DATABASE_PATH = _resolve_database_path()


async def init_db():
    """Initialize database tables"""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        # Create conversations table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        
        # Create messages table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                thinking TEXT,
                tool_calls TEXT,
                rag_references TEXT,
                created_at REAL NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        """)

        # Lightweight migration for older databases.
        async with db.execute("PRAGMA table_info(messages)") as cursor:
            message_columns = [row[1] for row in await cursor.fetchall()]
        if "thinking" not in message_columns:
            await db.execute("ALTER TABLE messages ADD COLUMN thinking TEXT")
        if "tool_calls" not in message_columns:
            await db.execute("ALTER TABLE messages ADD COLUMN tool_calls TEXT")
        if "rag_references" not in message_columns:
            await db.execute("ALTER TABLE messages ADD COLUMN rag_references TEXT")
        
        # Create memory table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS memory (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT,
                metadata TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        
        # Create download tasks table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT PRIMARY KEY,
                model_name TEXT NOT NULL,
                model_version TEXT NOT NULL,
                status TEXT NOT NULL,
                progress REAL DEFAULT 0,
                downloaded_size INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                speed REAL DEFAULT 0,
                eta INTEGER DEFAULT 0,
                status_text TEXT,
                retry_count INTEGER DEFAULT 0,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)

        async with db.execute("PRAGMA table_info(download_tasks)") as cursor:
            download_columns = [row[1] for row in await cursor.fetchall()]
        if "downloaded_size" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN downloaded_size INTEGER DEFAULT 0")
        if "total_size" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN total_size INTEGER DEFAULT 0")
        if "speed" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN speed REAL DEFAULT 0")
        if "eta" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN eta INTEGER DEFAULT 0")
        if "status_text" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN status_text TEXT")
        if "retry_count" not in download_columns:
            await db.execute("ALTER TABLE download_tasks ADD COLUMN retry_count INTEGER DEFAULT 0")

        # Computer use session state
        await db.execute("""
            CREATE TABLE IF NOT EXISTS computer_use_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                goal TEXT NOT NULL,
                approval_mode TEXT NOT NULL DEFAULT 'hands_free',
                parent_session_id TEXT,
                cwd TEXT NOT NULL,
                allowed_paths TEXT NOT NULL,
                status TEXT NOT NULL,
                latest_artifact_id TEXT,
                latest_screen_summary TEXT,
                thinking_text TEXT,
                assistant_text TEXT,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                started_at REAL,
                completed_at REAL
            )
        """)

        async with db.execute("PRAGMA table_info(computer_use_sessions)") as cursor:
            computer_use_session_columns = [row[1] for row in await cursor.fetchall()]
        if "approval_mode" not in computer_use_session_columns:
            await db.execute(
                "ALTER TABLE computer_use_sessions ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'hands_free'"
            )
        if "parent_session_id" not in computer_use_session_columns:
            await db.execute(
                "ALTER TABLE computer_use_sessions ADD COLUMN parent_session_id TEXT"
            )

        await db.execute("""
            CREATE TABLE IF NOT EXISTS computer_use_actions (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                input_payload TEXT,
                output_payload TEXT,
                status TEXT NOT NULL,
                requires_approval INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES computer_use_sessions(id) ON DELETE CASCADE
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS computer_use_approvals (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                action_id TEXT NOT NULL,
                status TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                reason TEXT,
                edited_input TEXT,
                created_at REAL NOT NULL,
                resolved_at REAL,
                FOREIGN KEY (session_id) REFERENCES computer_use_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (action_id) REFERENCES computer_use_actions(id) ON DELETE CASCADE
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS computer_use_artifacts (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                summary TEXT,
                created_at REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES computer_use_sessions(id) ON DELETE CASCADE
            )
        """)

        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_computer_use_actions_session ON computer_use_actions(session_id, created_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_computer_use_approvals_session ON computer_use_approvals(session_id, created_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_computer_use_artifacts_session ON computer_use_artifacts(session_id, created_at)"
        )

        await db.commit()


@asynccontextmanager
async def get_db():
    """Get database connection"""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        db.row_factory = aiosqlite.Row
        yield db


async def execute_query(query: str, params: tuple = ()) -> list:
    """Execute a query and return results"""
    async with get_db() as db:
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def execute_insert(query: str, params: tuple = ()) -> Optional[str]:
    """Execute an insert query and return the row id"""
    async with get_db() as db:
        cursor = await db.execute(query, params)
        await db.commit()
        return cursor.lastrowid


async def execute_update(query: str, params: tuple = ()) -> int:
    """Execute an update/delete query and return affected rows"""
    async with get_db() as db:
        cursor = await db.execute(query, params)
        await db.commit()
        return cursor.rowcount
