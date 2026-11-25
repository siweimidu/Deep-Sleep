package com.deep.sleep;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

/**
 * 聊天记录的原生镜像。
 *
 * 为什么要有它：WebView 的 IndexedDB 会因为"清除网站数据"、系统回收、内核对 storage 的清理而不声不响
 * 掉数据，而聊天记录对用户是不可再生的。这里用 SQLite 存一份按会话的 JSON 快照，Web 端发现
 * IndexedDB 空了就用它恢复。
 *
 * 设计取舍（和上游的结构化镜像不同）：
 *   1. **按会话存整块 JSON**：写入是原子的、没有跨表不一致，也不需要维护表结构与前端模型同步。
 *      前端本来只按整会话读取，没有"按消息查询"的需求，做关系表只是徒增迁移成本。
 *   2. **WAL + NORMAL**：写入不锁读，掉电最坏丢最后几十毫秒，对镜像来说够用。
 *   3. **所有写操作串行**：从 @JavascriptInterface 进来的是后台线程，SQLite 需要单写者。
 *   4. 只做"快照"，不做增量：删除、重命名、导入合并最终都会落到整会话写，增量日志反而更容易错。
 */
final class ChatStorage extends SQLiteOpenHelper {
    private static final String DB_NAME = "chat-mirror.db";
    private static final int DB_VERSION = 1;
    private static final String TABLE = "session_mirror";

    ChatStorage(Context context) {
        super(context.getApplicationContext(), DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS " + TABLE
            + " (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // 镜像只是缓存，结构变了直接重建即可，不需要迁移
        db.execSQL("DROP TABLE IF EXISTS " + TABLE);
        onCreate(db);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.enableWriteAheadLogging();
    }

    /** 写入/覆盖一个会话快照。body 是前端序列化好的 JSON。 */
    synchronized void put(String id, String body) {
        if (id == null || id.isEmpty() || body == null) {
            return;
        }
        try {
            ContentValues values = new ContentValues(3);
            values.put("id", id);
            values.put("body", body);
            values.put("updated", System.currentTimeMillis());
            getWritableDatabase().insertWithOnConflict(TABLE, null, values,
                SQLiteDatabase.CONFLICT_REPLACE);
        } catch (RuntimeException ignored) {
            // 镜像失败不能影响主流程：聊天本身已经写进 IndexedDB 了
        }
    }

    synchronized void remove(String id) {
        if (id == null || id.isEmpty()) {
            return;
        }
        try {
            getWritableDatabase().delete(TABLE, "id = ?", new String[]{id});
        } catch (RuntimeException ignored) {
            // 同上
        }
    }

    /** 全量导出，供前端在 IndexedDB 为空时恢复。返回 [[id, body], ...] 的 JSON。 */
    synchronized String dump() {
        List<String> pairs = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase()
            .query(TABLE, new String[]{"id", "body"}, null, null, null, null, "updated ASC")) {
            while (cursor.moveToNext()) {
                pairs.add("[" + quote(cursor.getString(0)) + "," + quote(cursor.getString(1)) + "]");
            }
        } catch (RuntimeException error) {
            return "[]";
        }
        return "[" + String.join(",", pairs) + "]";
    }

    /** 只取 id 列表，供前端判断哪些会话还需要回填（比 dump 轻得多）。返回 ["id", ...] 的 JSON。 */
    synchronized String ids() {
        List<String> ids = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase()
            .query(TABLE, new String[]{"id"}, null, null, null, null, "updated ASC")) {
            while (cursor.moveToNext()) {
                ids.add(quote(cursor.getString(0)));
            }
        } catch (RuntimeException error) {
            return "[]";
        }
        return "[" + String.join(",", ids) + "]";
    }

    synchronized int count() {
        try (Cursor cursor = getReadableDatabase()
            .rawQuery("SELECT COUNT(*) FROM " + TABLE, null)) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        } catch (RuntimeException error) {
            return 0;
        }
    }

    private static String quote(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder out = new StringBuilder(value.length() + 16);
        out.append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char ch = value.charAt(index);
            switch (ch) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (ch < 0x20) {
                        out.append(String.format("\\u%04x", (int) ch));
                    } else {
                        out.append(ch);
                    }
                }
            }
        }
        out.append('"');
        return out.toString();
    }
}
