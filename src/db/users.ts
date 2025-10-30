import { logger } from "../lib/logger";

export interface User {
  id: number;
  address: string;
  nickname?: string;
  avatar_url?: string;
  preferences?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserData {
  address: string;
  nickname?: string;
  avatar_url?: string;
  preferences?: string;
}

export interface UpdateUserData {
  nickname?: string;
  avatar_url?: string;
  preferences?: string;
}

export class UserDB {
  constructor(private db: D1Database) {}

  /**
   * 根据地址查找用户
   */
  async findByAddress(address: string): Promise<User | null> {
    try {
      const stmt = this.db.prepare("SELECT * FROM users WHERE address = ?").bind(address.toLowerCase());
      const result = await stmt.first() as User | null;
      return result;
    } catch (error) {
      logger.error("user_find_by_address_failed", { address, error: `${error}` });
      throw error;
    }
  }

  /**
   * 根据ID查找用户
   */
  async findById(id: number): Promise<User | null> {
    try {
      const stmt = this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id);
      const result = await stmt.first() as User | null;
      return result;
    } catch (error) {
      logger.error("user_find_by_id_failed", { id, error: `${error}` });
      throw error;
    }
  }

  /**
   * 创建新用户
   */
  async create(userData: CreateUserData): Promise<User> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO users (address, nickname, avatar_url, preferences)
        VALUES (?, ?, ?, ?)
      `).bind(
        userData.address.toLowerCase(),
        userData.nickname || null,
        userData.avatar_url || null,
        userData.preferences || null
      );

      const result = await stmt.run();

      if (!result.success) {
        throw new Error("Failed to create user");
      }

      const newUser = await this.findById(result.meta.last_row_id);
      if (!newUser) {
        throw new Error("Failed to retrieve created user");
      }

      logger.info("user_created", {
        userId: newUser.id,
        address: newUser.address
      });

      return newUser;
    } catch (error) {
      logger.error("user_create_failed", {
        address: userData.address,
        error: `${error}`
      });
      throw error;
    }
  }

  /**
   * 更新用户信息
   */
  async update(id: number, userData: UpdateUserData): Promise<User | null> {
    try {
      const fields: string[] = [];
      const values: any[] = [];

      if (userData.nickname !== undefined) {
        fields.push("nickname = ?");
        values.push(userData.nickname);
      }
      if (userData.avatar_url !== undefined) {
        fields.push("avatar_url = ?");
        values.push(userData.avatar_url);
      }
      if (userData.preferences !== undefined) {
        fields.push("preferences = ?");
        values.push(userData.preferences);
      }

      if (fields.length === 0) {
        throw new Error("No fields to update");
      }

      fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      values.push(id);

      const stmt = this.db.prepare(`
        UPDATE users
        SET ${fields.join(", ")}
        WHERE id = ?
      `).bind(...values);

      const result = await stmt.run();

      if (!result.success) {
        throw new Error("Failed to update user");
      }

      if (result.changes === 0) {
        return null;
      }

      const updatedUser = await this.findById(id);
      logger.info("user_updated", {
        userId: id,
        fields: fields.map(f => f.split(" = ")[0])
      });

      return updatedUser;
    } catch (error) {
      logger.error("user_update_failed", { id, error: `${error}` });
      throw error;
    }
  }

  /**
   * 根据地址更新用户信息
   */
  async updateByAddress(address: string, userData: UpdateUserData): Promise<User | null> {
    try {
      const user = await this.findByAddress(address);
      if (!user) {
        return null;
      }
      return await this.update(user.id, userData);
    } catch (error) {
      logger.error("user_update_by_address_failed", { address, error: `${error}` });
      throw error;
    }
  }

  /**
   * 删除用户
   */
  async delete(id: number): Promise<boolean> {
    try {
      const stmt = this.db.prepare("DELETE FROM users WHERE id = ?").bind(id);
      const result = await stmt.run();

      if (result.success && result.changes > 0) {
        logger.info("user_deleted", { userId: id });
        return true;
      }
      return false;
    } catch (error) {
      logger.error("user_delete_failed", { id, error: `${error}` });
      throw error;
    }
  }

  /**
   * 根据地址删除用户
   */
  async deleteByAddress(address: string): Promise<boolean> {
    try {
      const user = await this.findByAddress(address);
      if (!user) {
        return false;
      }
      return await this.delete(user.id);
    } catch (error) {
      logger.error("user_delete_by_address_failed", { address, error: `${error}` });
      throw error;
    }
  }

  /**
   * 获取或创建用户（如果用户不存在则创建）
   */
  async getOrCreate(address: string, userData?: Partial<CreateUserData>): Promise<User> {
    try {
      let user = await this.findByAddress(address);

      if (!user) {
        user = await this.create({
          address,
          ...userData
        });
      }

      return user;
    } catch (error) {
      logger.error("user_get_or_create_failed", { address, error: `${error}` });
      throw error;
    }
  }

  /**
   * 获取用户列表（分页）
   */
  async list(limit: number = 50, offset: number = 0): Promise<User[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM users
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset);

      const results = await stmt.all() as { results: User[] };
      return results.results || [];
    } catch (error) {
      logger.error("user_list_failed", { error: `${error}` });
      throw error;
    }
  }

  /**
   * 搜索用户（按昵称或地址）
   */
  async search(query: string, limit: number = 20): Promise<User[]> {
    try {
      const searchPattern = `%${query}%`;
      const stmt = this.db.prepare(`
        SELECT * FROM users
        WHERE LOWER(address) LIKE LOWER(?) OR LOWER(nickname) LIKE LOWER(?)
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(searchPattern, searchPattern, limit);

      const results = await stmt.all() as { results: User[] };
      return results.results || [];
    } catch (error) {
      logger.error("user_search_failed", { query, error: `${error}` });
      throw error;
    }
  }

  /**
   * 获取用户总数
   */
  async count(): Promise<number> {
    try {
      const stmt = this.db.prepare("SELECT COUNT(*) as count FROM users");
      const result = await stmt.first() as { count: number };
      return result.count || 0;
    } catch (error) {
      logger.error("user_count_failed", { error: `${error}` });
      throw error;
    }
  }
}