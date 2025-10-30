-- 为现有用户添加角色字段和默认值
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- 创建角色表
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 插入默认角色
INSERT OR IGNORE INTO user_roles (name, description) VALUES
  ('admin', '管理员用户，拥有系统全部权限'),
  ('user', '普通用户，可以访问基础功能'),
  ('guest', '访客用户，仅限公开访问');

-- 如果有现有用户但没有角色，设置为'user'
UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';